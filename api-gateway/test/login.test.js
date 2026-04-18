'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-for-login';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';

const { test, before } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const request = require('supertest');

const root = path.join(__dirname, '..');

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];
});

test('GET /login returns HTML', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app).get('/login').expect(200);
  assert.match(res.headers['content-type'] || '', /html/);
  assert.match(res.text, /Central Gateway/i);
});

test('POST /login wrong password returns 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app)
    .post('/login')
    .send({ username: 'officer1', password: 'wrong-password' })
    .expect(401)
    .expect('Content-Type', /json/);
});

test('POST /login police returns 200 otp_sent', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();

  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app)
    .post('/login')
    .send({ username: 'officer1', password: '1' })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.status, 'otp_sent');
  assert.strictEqual(res.body.role, 'police');
  assert.strictEqual(res.body.username, 'officer1');
  assert.ok(res.body.expiresAt);
  assert.ok(!Number.isNaN(Date.parse(res.body.expiresAt)));
  assert.strictEqual(tokenStore.size(), 1);
});

test('POST /login judge returns 302 to dashboard with sid (no JSON Accept)', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app)
    .post('/login')
    .redirects(0)
    .send({ username: 'judge1', password: '1' })
    .expect(302);

  const loc = res.headers.location;
  assert.ok(loc, 'Location header');
  assert.ok(loc.includes('8501') || loc.includes('localhost'), loc);
  assert.match(loc, /[?&]sid=/);
});

test('POST /login judge with Accept application/json returns 200 redirect body', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200)
    .expect('Content-Type', /json/);

  assert.strictEqual(res.body.status, 'redirect');
  assert.ok(res.body.location, res.body.location);
  assert.match(res.body.location, /[?&]sid=/);
  assert.strictEqual(res.body.role, 'judge');
});
