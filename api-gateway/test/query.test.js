'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-query-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';

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

function buildVerifiedCaseJson(caseId) {
  const skeleton = JSON.stringify({
    caseId,
    examiner: 'police',
    aggregateHash: '',
    aggregateHashNote: 'SHA-256 of body'
  });
  const agg = integrity.computeHash(skeleton);
  return JSON.stringify({
    caseId,
    examiner: 'police',
    aggregateHash: agg,
    aggregateHashNote: 'SHA-256 of body'
  });
}

let tmpRecordStorePath;
let origSelectByIndex;

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];

  tmpRecordStorePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'query-api-')),
    'case_record_store.json'
  );
  process.env.RECORD_STORE_PATH = tmpRecordStorePath;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/recordStore')];

  const chain = require('../src/services/chain');
  origSelectByIndex = chain.selectRecordByIndexHash;
  chain.selectRecordByIndexHash = async () => ({ indexHash: null, recordHash: null, rows: [] });

  delete require.cache[require.resolve('../src/app')];
  delete require.cache[require.resolve('../src/routes/query')];
});

after(() => {
  const chain = require('../src/services/chain');
  chain.selectRecordByIndexHash = origSelectByIndex;
  delete process.env.RECORD_STORE_PATH;
  try {
    fs.rmSync(path.dirname(tmpRecordStorePath), { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

function judgeAgent(app) {
  const agent = request.agent(app);
  return agent
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200)
    .then(() => agent);
}

test('POST /api/query without judge session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app).post('/api/query').send({ caseId: 'x' }).expect(401);
});

test('POST /api/query police session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/login').send({ username: 'officer1', password: '1' }).expect(200);
  await agent.post('/api/query').send({ caseId: 'x' }).expect(401);
});

test('POST /api/query 400 without caseId', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);
  await agent.post('/api/query').send({}).expect(400);
});

test('POST /api/query 404 unknown caseId', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);
  await agent.post('/api/query').send({ caseId: 'no-such-case' }).expect(404);
});

test('POST /api/query 200 onChain false when chain returns empty', async () => {
  const caseId = `Q-OFF-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { getDefaultRecordStore } = require('../src/services/recordStore');
  getDefaultRecordStore().save(caseId, caseJsonStr, aggFromJson, 'police', '2026-01-15T12:00:00.000Z');

  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);

  const res = await agent
    .post('/api/query')
    .send({ caseId })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.caseId, caseId);
  assert.strictEqual(res.body.integrity.recordHashMatch, false);
  assert.strictEqual(res.body.integrity.aggregateHashValid, true);
  assert.ok(res.body.chain.indexHash.startsWith('0x'));
  assert.strictEqual(res.body.record.case_id, caseId);
  assert.ok(res.body.integrity.recordHashLocal);
  assert.strictEqual(res.body.integrity.recordHashOnChain, null);
});

test('POST /api/query 200 onChain true when chain has row', async () => {
  const caseId = `Q-ON-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { getDefaultRecordStore } = require('../src/services/recordStore');
  getDefaultRecordStore().save(caseId, caseJsonStr, aggFromJson, 'police', '2026-01-15T12:00:00.000Z');

  const full = getDefaultRecordStore().get(caseId);
  const expectedRh = hashOnly.computeRecordHashFromJson(full);
  const indexHex = hashOnly.computeIndexHash(caseId);

  const chain = require('../src/services/chain');
  chain.selectRecordByIndexHash = async (ih) => {
    assert.strictEqual(
      String(ih).replace(/^0x/i, '').toLowerCase(),
      String(indexHex).toLowerCase()
    );
    return {
      indexHash: `0x${indexHex}`,
      recordHash: `0x${expectedRh}`,
      rows: [{ record_hash: `0x${expectedRh}`, index_hash: `0x${indexHex}` }]
    };
  };
  delete require.cache[require.resolve('../src/routes/query')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);

  const res = await agent.post('/api/query').send({ caseId }).expect(200);
  assert.strictEqual(res.body.integrity.recordHashMatch, true);
  assert.strictEqual(res.body.integrity.aggregateHashValid, true);
  assert.strictEqual(
    String(res.body.integrity.recordHashOnChain || '').toLowerCase(),
    `0x${expectedRh}`.toLowerCase()
  );
  assert.strictEqual(
    String(res.body.integrity.recordHashLocal || '').toLowerCase(),
    `0x${expectedRh}`.toLowerCase()
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.chain, 'txHash'));

  chain.selectRecordByIndexHash = async () => ({ indexHash: null, recordHash: null, rows: [] });
  delete require.cache[require.resolve('../src/app')];
});

test('POST /api/query chain.txHash from stored crud_tx_hash', async () => {
  const caseId = `Q-TX-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { getDefaultRecordStore } = require('../src/services/recordStore');
  getDefaultRecordStore().save(caseId, caseJsonStr, aggFromJson, 'police', '2026-01-15T12:00:00.000Z');
  const expectedTx = `0x${'ee'.repeat(32)}`;
  getDefaultRecordStore().mergeFields(caseId, { crud_tx_hash: expectedTx });

  const full = getDefaultRecordStore().get(caseId);
  const expectedRh = hashOnly.computeRecordHashFromJson(full);
  const indexHex = hashOnly.computeIndexHash(caseId);

  const chain = require('../src/services/chain');
  chain.selectRecordByIndexHash = async () => ({
    indexHash: `0x${indexHex}`,
    recordHash: `0x${expectedRh}`,
    rows: [{ record_hash: `0x${expectedRh}`, index_hash: `0x${indexHex}` }]
  });
  delete require.cache[require.resolve('../src/routes/query')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);

  const res = await agent.post('/api/query').send({ caseId }).expect(200);
  assert.strictEqual(String(res.body.chain.txHash || '').toLowerCase(), expectedTx.toLowerCase());

  chain.selectRecordByIndexHash = async () => ({ indexHash: null, recordHash: null, rows: [] });
  delete require.cache[require.resolve('../src/app')];
});

test('S3.6 tampered private store: recordHashMatch false; chain vs local hashes for diff', async () => {
  const caseId = `Q-TAMPER-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { getDefaultRecordStore } = require('../src/services/recordStore');
  getDefaultRecordStore().save(caseId, caseJsonStr, aggFromJson, 'police', '2026-01-15T12:00:00.000Z');

  const full = getDefaultRecordStore().get(caseId);
  const expectedRh = hashOnly.computeRecordHashFromJson(full);
  const indexHex = hashOnly.computeIndexHash(caseId);

  const chain = require('../src/services/chain');
  chain.selectRecordByIndexHash = async () => ({
    indexHash: `0x${indexHex}`,
    recordHash: `0x${expectedRh}`,
    rows: []
  });
  delete require.cache[require.resolve('../src/routes/query')];
  delete require.cache[require.resolve('../src/app')];

  const map = JSON.parse(fs.readFileSync(tmpRecordStorePath, 'utf8'));
  const rec = JSON.parse(map[caseId]);
  rec.examiner = 'tampered';
  map[caseId] = JSON.stringify(rec);
  fs.writeFileSync(tmpRecordStorePath, JSON.stringify(map), 'utf8');

  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);

  const res = await agent.post('/api/query').send({ caseId }).expect(200);
  assert.strictEqual(res.body.integrity.recordHashMatch, false);
  assert.strictEqual(res.body.integrity.aggregateHashValid, true);
  assert.strictEqual(
    String(res.body.integrity.recordHashOnChain || '').toLowerCase(),
    `0x${expectedRh}`.toLowerCase()
  );
  assert.notStrictEqual(
    String(res.body.integrity.recordHashLocal || '').toLowerCase(),
    String(res.body.integrity.recordHashOnChain || '').toLowerCase()
  );

  chain.selectRecordByIndexHash = async () => ({ indexHash: null, recordHash: null, rows: [] });
  delete require.cache[require.resolve('../src/app')];
});

test('POST /api/query 503 when chain not configured', async () => {
  const chain = require('../src/services/chain');
  const prev = chain.selectRecordByIndexHash;
  chain.selectRecordByIndexHash = async () => {
    const err = new Error('Chain not configured:\nx');
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  };
  delete require.cache[require.resolve('../src/routes/query')];
  delete require.cache[require.resolve('../src/app')];

  const caseId = `Q-503-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;
  const { getDefaultRecordStore } = require('../src/services/recordStore');
  getDefaultRecordStore().save(caseId, caseJsonStr, aggFromJson, 'police', '2026-01-15T12:00:00.000Z');

  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = await judgeAgent(app);
  await agent.post('/api/query').send({ caseId }).expect(503);

  chain.selectRecordByIndexHash = prev;
  delete require.cache[require.resolve('../src/app')];
});
