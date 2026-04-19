'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-modify-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';
process.env.CASE_REGISTRY_ADDR = '0x1111111111111111111111111111111111111111';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const request = require('supertest');

const root = path.join(__dirname, '..');
const integrity = require('../src/services/integrity');
const hashOnly = require('../src/services/hashOnly');

function buildVerifiedCaseJson(caseId, note) {
  const skeleton = JSON.stringify({
    caseId,
    examiner: 'police',
    aggregateHash: '',
    aggregateHashNote: note || 'SHA-256 of body'
  });
  const agg = integrity.computeHash(skeleton);
  return JSON.stringify({
    caseId,
    examiner: 'police',
    aggregateHash: agg,
    aggregateHashNote: note || 'SHA-256 of body'
  });
}

let tmpRecordStorePath;
let origGetRecordHash;
let origPropose;
let origGetProposal;

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];

  tmpRecordStorePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'modify-api-')),
    'case_record_store.json'
  );
  process.env.RECORD_STORE_PATH = tmpRecordStorePath;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/recordStore')];

  const caseRegistryTx = require('../src/services/caseRegistryTx');
  origGetRecordHash = caseRegistryTx.getRecordHashOnRegistry;
  origPropose = caseRegistryTx.proposeFromUserKeystore;
  origGetProposal = caseRegistryTx.getProposalFromRegistry;

  caseRegistryTx.getRecordHashOnRegistry = async (indexHashHex) => {
    const ih = String(indexHashHex).replace(/^0x/i, '').toLowerCase();
    const rs = require('../src/services/recordStore').getDefaultRecordStore();
    let raw;
    try {
      raw = fs.readFileSync(rs.storePath, 'utf8');
    } catch {
      return null;
    }
    if (!String(raw).trim()) {
      return null;
    }
    let store;
    try {
      store = JSON.parse(raw);
    } catch {
      return null;
    }
    for (const k of Object.keys(store)) {
      if (k.includes('::pending-')) {
        continue;
      }
      if (hashOnly.computeIndexHash(k).toLowerCase() === ih) {
        const full = String(store[k]);
        return `0x${hashOnly.computeRecordHashFromJson(full)}`;
      }
    }
    return null;
  };

  caseRegistryTx.proposeFromUserKeystore = async (opts) => ({
    txHash: `0x${'cc'.repeat(32)}`,
    blockNumber: 7,
    proposalCreated: {
      proposalId: String(opts.proposalIdHex).toLowerCase().startsWith('0x')
        ? String(opts.proposalIdHex).toLowerCase()
        : `0x${String(opts.proposalIdHex).toLowerCase()}`,
      indexHash: `0x${String(opts.indexHashHex).replace(/^0x/i, '').toLowerCase().padStart(64, '0').slice(0, 64)}`,
      proposer: `0x${'22'.repeat(20)}`
    }
  });

  caseRegistryTx.getProposalFromRegistry = async (proposalIdHex) => ({
    indexHash: `0x${'dd'.repeat(32)}`,
    oldRecordHash: `0x${'ee'.repeat(32)}`,
    newRecordHash: `0x${'ff'.repeat(32)}`,
    proposer: `0x${'22'.repeat(20)}`,
    approver: null,
    status: 1,
    statusName: 'Pending',
    proposedAt: '1',
    decidedAt: '0',
    reason: 'unit test'
  });

  delete require.cache[require.resolve('../src/app')];
});

after(() => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.getRecordHashOnRegistry = origGetRecordHash;
  caseRegistryTx.proposeFromUserKeystore = origPropose;
  caseRegistryTx.getProposalFromRegistry = origGetProposal;
  delete process.env.RECORD_STORE_PATH;
  try {
    fs.rmSync(path.dirname(tmpRecordStorePath), { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

/** S7.1 警察会话：OTP → POST /api/auth/police-otp → Cookie */
async function withPoliceSession(app) {
  const tokenStore = require('../src/services/tokenStore');
  const otp = 'sessessessessessessessessessess';
  tokenStore.issue('u-police-1', otp, 60_000);
  const agent = request.agent(app);
  await agent
    .post('/api/auth/police-otp')
    .send({ username: 'officer1', otp })
    .expect(200)
    .expect('Content-Type', /json/);
  return agent;
}

async function withJudgeSession(app) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200);
  return agent;
}

test('POST /api/modify/propose without police session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app)
    .post('/api/modify/propose')
    .send({ caseId: 'x', caseJson: '{}' })
    .expect(401);
});

test('S7.1: propose + proposalCreated + judge GET returns Pending', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();

  const caseId = `MODIFY-OK-${Date.now()}`;
  const caseJsonInitial = buildVerifiedCaseJson(caseId, 'v1');
  const aggInitial = JSON.parse(caseJsonInitial).aggregateHash;

  const rs = require('../src/services/recordStore').getDefaultRecordStore();
  rs.save(caseId, caseJsonInitial, aggInitial, 'police', '2026-01-15T12:00:00.000Z');

  const caseJsonNew = buildVerifiedCaseJson(caseId, 'v2');
  const aggNew = JSON.parse(caseJsonNew).aggregateHash;
  assert.ok(integrity.verify(caseJsonNew));

  const fixedProposalId = `0x${'ab'.repeat(32)}`;

  const { createApp } = require('../src/app');
  const app = createApp();
  const policeAgent = await withPoliceSession(app);

  const res = await policeAgent
    .post('/api/modify/propose')
    .send({
      caseId,
      caseJson: caseJsonNew,
      aggregateHash: aggNew,
      examiner: 'police',
      generatedAt: '2026-02-01T12:00:00.000Z',
      signingPassword: 'irrelevant-mocked',
      proposalId: fixedProposalId,
      reason: 'update'
    })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.proposalId, fixedProposalId);
  assert.strictEqual(res.body.txHash, `0x${'cc'.repeat(32)}`);
  assert.ok(res.body.proposalCreated && res.body.proposalCreated.proposalId);
  assert.ok(res.body.oldRecordHash && res.body.newRecordHash);
  const pkey = `${caseId}::pending-${fixedProposalId}`;
  assert.strictEqual(res.body.pendingKey, pkey);
  const pending = rs.get(pkey);
  assert.ok(pending);

  const judgeAgent = await withJudgeSession(app);
  const g = await judgeAgent.get(`/api/modify/${fixedProposalId.slice(2)}`).expect(200);

  assert.strictEqual(g.body.status, 'Pending');
  assert.strictEqual(g.body.proposalId, fixedProposalId);
});

test('GET /api/modify/:id without judge session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const pid = `${'ab'.repeat(32)}`;
  await request(app).get(`/api/modify/${pid}`).expect(401);
});

test('GET /api/modify/:id police session cannot read (S7.5 前仅法官)', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await withPoliceSession(app);
  const pid = `${'ab'.repeat(32)}`;
  await agent.get(`/api/modify/${pid}`).expect(401);
});

test('GET /api/modify/:id 404 when proposal empty on chain', async () => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  const prev = caseRegistryTx.getProposalFromRegistry;
  caseRegistryTx.getProposalFromRegistry = async () => ({
    indexHash: `0x${'0'.repeat(64)}`,
    oldRecordHash: `0x${'0'.repeat(64)}`,
    newRecordHash: `0x${'0'.repeat(64)}`,
    proposer: `0x${'0'.repeat(40)}`,
    approver: null,
    status: 0,
    statusName: 'None',
    proposedAt: '0',
    decidedAt: '0',
    reason: ''
  });

  try {
    delete require.cache[require.resolve('../src/app')];
    const { createApp } = require('../src/app');
    const app = createApp();
    const judgeAgent = await withJudgeSession(app);
    const pid = `${'cd'.repeat(32)}`;
    await judgeAgent.get(`/api/modify/${pid}`).expect(404);
  } finally {
    caseRegistryTx.getProposalFromRegistry = prev;
    delete require.cache[require.resolve('../src/app')];
  }
});
