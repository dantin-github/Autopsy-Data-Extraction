'use strict';

/**
 * Phase 3 S3.7 smoke: 6 checks without a listening server (supertest + chain mocks).
 * Run from api-gateway: npm run smoke
 *
 * Assertions:
 *  1) GET /health
 *  2) POST /login judge → 200 JSON redirect
 *  3) POST /login police → otp_sent (MAIL_DRY_RUN)
 *  4) OTP one-time: second /api/upload with same token → 401
 *  5) POST /api/upload then /api/query → integrity.recordHashMatch true
 *  6) Tamper private store → recordHashMatch false
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('node:assert');
const request = require('supertest');

const root = path.join(__dirname, '..');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'smoke-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';

const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-smoke-'));
const recordPath = path.join(tmpDir, 'case_record_store.json');
process.env.RECORD_STORE_PATH = recordPath;

function fail(msg, err) {
  console.error(msg);
  if (err) {
    console.error(err);
  }
  process.exit(1);
}

function buildVerifiedCaseJson(caseId) {
  const integrity = require('../src/services/integrity');
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

(async () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  if (r.status !== 0) {
    fail('seed-users failed');
  }

  delete require.cache[require.resolve('../src/services/userStore')];

  const chain = require('../src/services/chain');
  const origInsert = chain.insertRecord;
  const origSelIdx = chain.selectRecordByIndexHash;

  let lastInsertRow;
  chain.insertRecord = async (row) => {
    lastInsertRow = row;
    return { txHash: `0x${'aa'.repeat(32)}`, blockNumber: 42, affected: 1 };
  };
  chain.selectRecordByIndexHash = async (indexHashArg) => {
    if (!lastInsertRow) {
      return { indexHash: null, recordHash: null, rows: [] };
    }
    const want = String(indexHashArg).replace(/^0x/i, '').toLowerCase();
    const have = String(lastInsertRow.indexHash).replace(/^0x/i, '').toLowerCase();
    if (want !== have) {
      return { indexHash: null, recordHash: null, rows: [] };
    }
    const rh = String(lastInsertRow.recordHash);
    const recordHash = rh.startsWith('0x') ? rh : `0x${rh}`;
    return { indexHash: `0x${have}`, recordHash, rows: [{ record_hash: recordHash }] };
  };

  const mailer = require('../src/services/mailer');
  const origMailSend = mailer.send;
  let lastOtp;
  mailer.send = async function smokeMail(opts) {
    const m = opts.text && opts.text.match(/\n\n([0-9a-f]{16})\n\n/);
    lastOtp = m ? m[1] : null;
    return origMailSend.call(this, opts);
  };

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/recordStore')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  const app = createApp();
  const tokenStore = require('../src/services/tokenStore');

  // 1) Health
  let res = await request(app).get('/health').expect(200);
  assert.strictEqual(res.body.status, 'ok', 'health status');
  console.log('[1/6] GET /health ok');

  // 2) Judge login
  const judgeAgent = request.agent(app);
  res = await judgeAgent
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200);
  assert.strictEqual(res.body.role, 'judge', 'judge role');
  console.log('[2/6] POST /login judge ok');

  // 3) Police OTP
  tokenStore.clear();
  lastOtp = null;
  res = await request(app)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'officer1', password: '1' })
    .expect(200);
  assert.strictEqual(res.body.status, 'otp_sent', 'police otp_sent');
  assert.ok(lastOtp && /^[0-9a-f]{16}$/.test(lastOtp), 'OTP captured from mailer');
  const otp1 = lastOtp;
  console.log('[3/6] POST /login police otp_sent');

  const caseId = `smoke-${Date.now()}`;
  const caseJsonStr = buildVerifiedCaseJson(caseId);
  const aggFromJson = JSON.parse(caseJsonStr).aggregateHash;
  const uploadBody = {
    caseId,
    examiner: 'officer1',
    aggregateHash: aggFromJson,
    generatedAt: new Date().toISOString(),
    caseJson: caseJsonStr
  };

  res = await request(app)
    .post('/api/upload')
    .set('X-Auth-Token', otp1)
    .send(uploadBody)
    .expect(200);
  assert.ok(res.body.txHash, 'upload txHash');
  console.log('[4a] POST /api/upload 200');

  await request(app)
    .post('/api/upload')
    .set('X-Auth-Token', otp1)
    .send(uploadBody)
    .expect(401);
  console.log('[4/6] OTP one-time: replay upload -> 401');

  res = await judgeAgent.post('/api/query').send({ caseId }).expect(200);
  assert.strictEqual(res.body.integrity.recordHashMatch, true, 'query match');
  assert.strictEqual(res.body.integrity.aggregateHashValid, true, 'aggregate valid');
  console.log('[5/6] POST /api/query recordHashMatch true');

  const raw = fs.readFileSync(recordPath, 'utf8');
  const map = JSON.parse(raw);
  const rec = JSON.parse(map[caseId]);
  rec.examiner = 'tampered-smoke';
  map[caseId] = JSON.stringify(rec);
  fs.writeFileSync(recordPath, JSON.stringify(map), 'utf8');

  res = await judgeAgent.post('/api/query').send({ caseId }).expect(200);
  assert.strictEqual(res.body.integrity.recordHashMatch, false, 'tamper mismatch');
  console.log('[6/6] POST /api/query after tamper recordHashMatch false');

  chain.insertRecord = origInsert;
  chain.selectRecordByIndexHash = origSelIdx;
  mailer.send = origMailSend;

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  console.log('\nS3.7 smoke: all 6 checks passed.');
  process.exit(0);
})().catch((e) => {
  fail('smoke failed', e);
});
