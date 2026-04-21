'use strict';

/**
 * S7.6: HTTP-level negative paths for /api/modify/* — 4xx + chainError.revertReason (+ txHash).
 * Writes docs/evidence/e2e-negative/s7.6-manifest.jsonl (recreated each run).
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-e2e-neg-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';
process.env.CASE_REGISTRY_ADDR = '0x1111111111111111111111111111111111111111';
process.env.CHAIN_MODE = 'crud';
process.env.UPLOAD_USE_CASE_REGISTRY = '0';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const request = require('supertest');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'e2e-negative');
const evidenceFile = path.join(evidenceDir, 's7.6-manifest.jsonl');

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

function appendEvidence(row) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.appendFileSync(evidenceFile, `${JSON.stringify(row)}\n`, 'utf8');
}

let tmpRecordStorePath;
let origPropose;
let origApprove;
let origReject;
let origExecute;
let origGetRecordHash;

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];

  tmpRecordStorePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-neg-')),
    'case_record_store.json'
  );
  process.env.RECORD_STORE_PATH = tmpRecordStorePath;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/recordStore')];

  fs.mkdirSync(evidenceDir, { recursive: true });
  if (fs.existsSync(evidenceFile)) {
    fs.unlinkSync(evidenceFile);
  }

  const caseRegistryTx = require('../src/services/caseRegistryTx');
  origGetRecordHash = caseRegistryTx.getRecordHashOnRegistry;
  origPropose = caseRegistryTx.proposeFromUserKeystore;
  origApprove = caseRegistryTx.approveFromUserKeystore;
  origReject = caseRegistryTx.rejectFromUserKeystore;
  origExecute = caseRegistryTx.executeFromUserKeystore;

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

  delete require.cache[require.resolve('../src/app')];
});

beforeEach(() => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.proposeFromUserKeystore = origPropose;
  caseRegistryTx.approveFromUserKeystore = origApprove;
  caseRegistryTx.rejectFromUserKeystore = origReject;
  caseRegistryTx.executeFromUserKeystore = origExecute;
  delete require.cache[require.resolve('../src/app')];
});

after(() => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.getRecordHashOnRegistry = origGetRecordHash;
  caseRegistryTx.proposeFromUserKeystore = origPropose;
  caseRegistryTx.approveFromUserKeystore = origApprove;
  caseRegistryTx.rejectFromUserKeystore = origReject;
  caseRegistryTx.executeFromUserKeystore = origExecute;
  delete process.env.RECORD_STORE_PATH;
  try {
    fs.rmSync(path.dirname(tmpRecordStorePath), { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

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

test('S7.6: POST propose chain revert → 409 + chainError', async () => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.proposeFromUserKeystore = async () => {
    const err = new Error('proposal exists');
    err.code = 'PROPOSE_FAILED';
    err.status = 409;
    err.chainError = { revertReason: 'proposal exists', txHash: `0x${'a1'.repeat(32)}` };
    throw err;
  };
  delete require.cache[require.resolve('../src/app')];
  const { createApp } = require('../src/app');
  const app = createApp();

  const caseId = `E2E-NEG-P-${Date.now()}`;
  const caseJsonInitial = buildVerifiedCaseJson(caseId, 'v0');
  const agg0 = JSON.parse(caseJsonInitial).aggregateHash;
  const rs = require('../src/services/recordStore').getDefaultRecordStore();
  rs.save(caseId, caseJsonInitial, agg0, 'police', '2026-01-15T12:00:00.000Z');

  const caseJsonNew = buildVerifiedCaseJson(caseId, 'v1');
  const aggNew = JSON.parse(caseJsonNew).aggregateHash;
  const agent = await withPoliceSession(app);
  const res = await agent
    .post('/api/modify/propose')
    .send({
      caseId,
      caseJson: caseJsonNew,
      aggregateHash: aggNew,
      examiner: 'police',
      generatedAt: '2026-02-01T12:00:00.000Z',
      signingPassword: 'irrelevant-mocked',
      proposalId: `0x${'bb'.repeat(32)}`,
      reason: 'x'
    })
    .expect(409)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.error, 'proposal exists');
  assert.strictEqual(res.body.chainError.revertReason, 'proposal exists');
  assert.strictEqual(res.body.chainError.txHash, `0x${'a1'.repeat(32)}`);
  appendEvidence({
    scenario: 'propose_proposal_exists',
    endpoint: 'POST /api/modify/propose',
    httpStatus: 409,
    code: 'PROPOSE_FAILED',
    revertReason: res.body.chainError.revertReason,
    txHash: res.body.chainError.txHash
  });
});

test('S7.6: POST approve chain revert → 409 + chainError', async () => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.approveFromUserKeystore = async () => {
    const err = new Error('not pending');
    err.code = 'APPROVE_FAILED';
    err.status = 409;
    err.chainError = { revertReason: 'not pending', txHash: `0x${'a2'.repeat(32)}` };
    throw err;
  };
  delete require.cache[require.resolve('../src/app')];
  const { createApp } = require('../src/app');
  const app = createApp();
  const judgeAgent = await withJudgeSession(app);
  const pid = `0x${'cc'.repeat(32)}`;
  const res = await judgeAgent
    .post('/api/modify/approve')
    .send({ proposalId: pid, signingPassword: '1' })
    .expect(409)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.error, 'not pending');
  assert.strictEqual(res.body.chainError.revertReason, 'not pending');
  assert.strictEqual(res.body.chainError.txHash, `0x${'a2'.repeat(32)}`);
  appendEvidence({
    scenario: 'approve_not_pending',
    endpoint: 'POST /api/modify/approve',
    httpStatus: 409,
    code: 'APPROVE_FAILED',
    revertReason: res.body.chainError.revertReason,
    txHash: res.body.chainError.txHash
  });
});

test('S7.6: POST reject chain revert → 403 + chainError', async () => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.rejectFromUserKeystore = async () => {
    const err = new Error('self reject');
    err.code = 'REJECT_FAILED';
    err.status = 403;
    err.chainError = { revertReason: 'self reject', txHash: `0x${'a3'.repeat(32)}` };
    throw err;
  };
  delete require.cache[require.resolve('../src/app')];
  const { createApp } = require('../src/app');
  const app = createApp();
  const judgeAgent = await withJudgeSession(app);
  const pid = `0x${'dd'.repeat(32)}`;
  const res = await judgeAgent
    .post('/api/modify/reject')
    .send({ proposalId: pid, signingPassword: '1', reason: 'no' })
    .expect(403)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.error, 'self reject');
  assert.strictEqual(res.body.chainError.revertReason, 'self reject');
  assert.strictEqual(res.body.chainError.txHash, `0x${'a3'.repeat(32)}`);
  appendEvidence({
    scenario: 'reject_self_reject',
    endpoint: 'POST /api/modify/reject',
    httpStatus: 403,
    code: 'REJECT_FAILED',
    revertReason: res.body.chainError.revertReason,
    txHash: res.body.chainError.txHash
  });
});

test('S7.6: POST execute chain revert → 409 + chainError', async () => {
  const caseRegistryTx = require('../src/services/caseRegistryTx');
  caseRegistryTx.executeFromUserKeystore = async () => {
    const err = new Error('not approved');
    err.code = 'EXECUTE_FAILED';
    err.status = 409;
    err.chainError = { revertReason: 'not approved', txHash: `0x${'a4'.repeat(32)}` };
    throw err;
  };
  delete require.cache[require.resolve('../src/app')];
  const { createApp } = require('../src/app');
  const app = createApp();

  const caseId = `E2E-NEG-E-${Date.now()}`;
  const pid = `0x${'ee'.repeat(32)}`;
  const caseJsonInitial = buildVerifiedCaseJson(caseId, 'v0');
  const agg0 = JSON.parse(caseJsonInitial).aggregateHash;
  const rs = require('../src/services/recordStore').getDefaultRecordStore();
  rs.save(caseId, caseJsonInitial, agg0, 'police', '2026-01-15T12:00:00.000Z');
  const caseJsonNew = buildVerifiedCaseJson(caseId, 'v1');
  const agg1 = JSON.parse(caseJsonNew).aggregateHash;
  const pendingFull = JSON.stringify({
    case_id: caseId,
    case_json: String(caseJsonNew),
    aggregate_hash: String(agg1),
    examiner: 'police',
    created_at: '2026-02-01T12:00:00.000Z'
  });
  rs.save(`${caseId}::pending-${pid}`, pendingFull);

  const agent = await withPoliceSession(app);
  const res = await agent
    .post('/api/modify/execute')
    .send({ proposalId: pid, signingPassword: 'irrelevant-mocked' })
    .expect(409)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.error, 'not approved');
  assert.strictEqual(res.body.chainError.revertReason, 'not approved');
  assert.strictEqual(res.body.chainError.txHash, `0x${'a4'.repeat(32)}`);
  appendEvidence({
    scenario: 'execute_not_approved',
    endpoint: 'POST /api/modify/execute',
    httpStatus: 409,
    code: 'EXECUTE_FAILED',
    revertReason: res.body.chainError.revertReason,
    txHash: res.body.chainError.txHash
  });
});
