'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-audit-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const request = require('supertest');

const root = path.join(__dirname, '..');

let tmpAuditPath;

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];

  tmpAuditPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-')), 'audit.jsonl');
  process.env.AUDIT_LOG_PATH = tmpAuditPath;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/auditLog')];
  delete require.cache[require.resolve('../src/services/eventListener')];
  delete require.cache[require.resolve('../src/routes/audit')];
  delete require.cache[require.resolve('../src/app')];
});

function writeLines(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      JSON.stringify({
        ts: new Date(1000 + i).toISOString(),
        blockNumber: i + 1,
        txHash: `0x${String(i).padStart(64, '0')}`,
        logIndex: 0,
        event: 'ProposalCreated',
        args: { index: i }
      })
    );
  }
  fs.writeFileSync(tmpAuditPath, `${rows.join('\n')}\n`, 'utf8');
}

test('GET /api/audit without judge session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app).get('/api/audit').expect(401);
});

test('S8.2: GET /api/audit returns newest first, limit & since', async () => {
  writeLines(120);
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = request.agent(app);
  await agent
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200);

  const res = await agent.get('/api/audit?limit=10').expect(200).expect('Content-Type', /json/);
  assert.strictEqual(res.body.items.length, 10);
  assert.strictEqual(res.body.items[0].blockNumber, 120);
  assert.strictEqual(res.body.items[9].blockNumber, 111);
  assert.strictEqual(res.body.limit, 10);
  const row0 = res.body.items[0];
  assert.ok('caseId' in row0);
  assert.ok('callerName' in row0);
  assert.ok('rejectReason' in row0);
  assert.ok('eventDate' in row0);
  assert.ok('eventTime' in row0);

  const since = new Date(1050).toISOString();
  const res2 = await agent.get(`/api/audit?since=${encodeURIComponent(since)}&limit=50`).expect(200);
  assert.ok(res2.body.items.length >= 1);
  assert.ok(res2.body.items.every((r) => new Date(r.ts) >= new Date(since)));
});

test('S8.2: readAuditLines 1000 lines p95 under 200ms (local)', () => {
  const lines = [];
  for (let i = 0; i < 1000; i++) {
    lines.push(
      JSON.stringify({
        ts: new Date(10_000 + i).toISOString(),
        blockNumber: i,
        txHash: `0x${'ab'.repeat(32)}`,
        logIndex: i % 3,
        event: 'RecordCreated',
        args: {}
      })
    );
  }
  fs.writeFileSync(tmpAuditPath, `${lines.join('\n')}\n`, 'utf8');

  const { readAuditLines } = require('../src/services/auditLog');
  const times = [];
  for (let k = 0; k < 20; k++) {
    const t0 = Date.now();
    const items = readAuditLines({ limit: 50, auditLogPath: tmpAuditPath });
    times.push(Date.now() - t0);
    assert.strictEqual(items.length, 50);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 200, `expected p95 < 200ms, got ${p95}ms`);
});
