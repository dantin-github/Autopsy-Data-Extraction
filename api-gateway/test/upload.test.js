'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-upload-session-secret';
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

/** Build caseJson where aggregateHash matches integrity.computeHash for that document. */
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
let origInsertRecord;
let origGetBlockTimestampUtcIso;

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];

  tmpRecordStorePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'upload-api-')),
    'case_record_store.json'
  );
  process.env.RECORD_STORE_PATH = tmpRecordStorePath;
  /* Isolate from developer .env (e.g. CHAIN_MODE=contract + CASE_REGISTRY_ADDR). */
  process.env.CHAIN_MODE = 'crud';
  process.env.CASE_REGISTRY_ADDR = '';
  process.env.UPLOAD_USE_CASE_REGISTRY = '0';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/recordStore')];

  const chain = require('../src/services/chain');
  origInsertRecord = chain.insertRecord;
  chain.insertRecord = async () => ({
    txHash: `0x${'aa'.repeat(32)}`,
    blockNumber: 42,
    affected: 1
  });
  origGetBlockTimestampUtcIso = chain.getBlockTimestampUtcIso;
  chain.getBlockTimestampUtcIso = async () => '2026-01-15T12:00:42.000Z';

  delete require.cache[require.resolve('../src/app')];
  delete require.cache[require.resolve('../src/routes/upload')];
});

after(() => {
  const chain = require('../src/services/chain');
  chain.insertRecord = origInsertRecord;
  chain.getBlockTimestampUtcIso = origGetBlockTimestampUtcIso;
  delete process.env.RECORD_STORE_PATH;
  try {
    fs.rmSync(path.dirname(tmpRecordStorePath), { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

test('POST /api/upload without token → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app)
    .post('/api/upload')
    .send({ caseId: 'x', caseJson: '{}' })
    .expect(401);
});

test('POST /api/upload 400 when integrity fails', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  tokenStore.issue('u-police-1', 'abcdabcdabcdabcdabcdabcdabcdabcd', 60_000);

  const { createApp } = require('../src/app');
  const app = createApp();

  const badJson = JSON.stringify({
    caseId: 'X',
    examiner: 'e',
    aggregateHash: 'deadbeef',
    aggregateHashNote: ''
  });
  assert.strictEqual(integrity.verify(badJson), false);

  const res = await request(app)
    .post('/api/upload')
    .set('X-Auth-Token', 'abcdabcdabcdabcdabcdabcdabcdabcd')
    .send({
      caseId: 'X',
      examiner: 'e',
      aggregateHash: 'deadbeef',
      generatedAt: '2025-01-01T00:00:00.000Z',
      caseJson: badJson
    })
    .expect(400)
    .expect('Content-Type', /json/);

  assert.match(res.body.error || '', /aggregate hash verification failed/i);
});

test('POST /api/upload 200 returns hashes and mocked tx', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  tokenStore.issue('u-police-1', 'feedfeedfeedfeedfeedfeedfeedfeed', 60_000);

  const caseId = `UPLOAD-OK-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { createApp } = require('../src/app');
  const app = createApp();

  const res = await request(app)
    .post('/api/upload')
    .set('X-Auth-Token', 'feedfeedfeedfeedfeedfeedfeedfeed')
    .send({
      caseId,
      examiner: 'police',
      aggregateHash: aggFromJson,
      generatedAt: '2026-01-15T12:00:00.000Z',
      caseJson: caseJsonStr
    })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.ok(res.body.indexHash && res.body.indexHash.startsWith('0x'));
  assert.ok(res.body.recordHash && res.body.recordHash.startsWith('0x'));
  assert.strictEqual(res.body.txHash, `0x${'aa'.repeat(32)}`);
  assert.strictEqual(res.body.blockNumber, 42);
  assert.strictEqual(res.body.requestId, undefined);
  assert.strictEqual(res.body.timing, undefined);

  const rs = require('../src/services/recordStore').getDefaultRecordStore();
  const got = rs.get(caseId);
  assert.ok(got);
  const parsed = JSON.parse(got);
  assert.strictEqual(parsed.case_id, caseId);
  assert.strictEqual(parsed.crud_tx_hash, `0x${'aa'.repeat(32)}`);
  assert.strictEqual(parsed.crud_block_number, 42);
});

test('POST /api/upload with X-Debug-Timing: 1 returns requestId, timing, blockTimestampUtc', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  tokenStore.issue('u-police-1', 'cafebabecafebabecafebabecafebabe', 60_000);

  const caseId = `UPLOAD-TIME-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;

  const { createApp } = require('../src/app');
  const app = createApp();

  const res = await request(app)
    .post('/api/upload')
    .set('X-Auth-Token', 'cafebabecafebabecafebabecafebabe')
    .set('X-Debug-Timing', '1')
    .send({
      caseId,
      examiner: 'police',
      aggregateHash: aggFromJson,
      generatedAt: '2026-01-15T12:00:00.000Z',
      caseJson: caseJsonStr
    })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.match(res.body.requestId || '', /^[0-9a-f-]{36}$/i);
  assert.ok(res.body.timing);
  assert.strictEqual(typeof res.body.timing.integrityMs, 'number');
  assert.strictEqual(typeof res.body.timing.chainMs, 'number');
  assert.strictEqual(typeof res.body.timing.totalMs, 'number');
  assert.strictEqual(res.body.blockTimestampUtc, '2026-01-15T12:00:42.000Z');
});
