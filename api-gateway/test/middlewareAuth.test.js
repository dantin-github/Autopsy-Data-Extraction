'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-mw-session-secret';
process.env.MAIL_DRY_RUN = process.env.MAIL_DRY_RUN || '1';
/* Isolate from developer .env (X_AUTH_TOKEN_SINGLE_USE=0 breaks single-use expectation). */
process.env.X_AUTH_TOKEN_SINGLE_USE = '1';

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

test('__police-only: no X-Auth-Token → 401', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app).get('/__police-only').expect(401);
});

test('__police-only: wrong token → 401', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app).get('/__police-only').set('X-Auth-Token', 'not-a-valid-token').expect(401);
});

test('__police-only: valid token → 200, second request → 401', async () => {
  const tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
  tokenStore.issue('u-police-1', 'test-otp-token-16hex', 60_000);

  const { createApp } = require('../src/app');
  const app = createApp();

  const ok = await request(app)
    .get('/__police-only')
    .set('X-Auth-Token', 'test-otp-token-16hex')
    .expect(200);
  assert.strictEqual(ok.body.ok, true);
  assert.strictEqual(ok.body.userId, 'u-police-1');

  await request(app).get('/__police-only').set('X-Auth-Token', 'test-otp-token-16hex').expect(401);
});

test('__police-only: X_AUTH_TOKEN_SINGLE_USE=0 same token → 200 twice', async () => {
  const prev = process.env.X_AUTH_TOKEN_SINGLE_USE;
  process.env.X_AUTH_TOKEN_SINGLE_USE = '0';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/middleware/requirePoliceToken')];
  delete require.cache[require.resolve('../src/app')];

  try {
    const tokenStore = require('../src/services/tokenStore');
    tokenStore.clear();
    tokenStore.issue('u-police-1', 'reusable-otp-16b-hex-01', 60_000);

    const { createApp } = require('../src/app');
    const app = createApp();
    const tok = 'reusable-otp-16b-hex-01';
    const a = await request(app).get('/__police-only').set('X-Auth-Token', tok).expect(200);
    const b = await request(app).get('/__police-only').set('X-Auth-Token', tok).expect(200);
    assert.strictEqual(a.body.userId, 'u-police-1');
    assert.strictEqual(b.body.userId, 'u-police-1');
  } finally {
    process.env.X_AUTH_TOKEN_SINGLE_USE = prev !== undefined ? prev : '1';
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/middleware/requirePoliceToken')];
    delete require.cache[require.resolve('../src/app')];
  }
});

test('__judge-only: no session → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  await request(app).get('/__judge-only').expect(401);
});

test('__judge-only: judge session → 200', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = request.agent(app);
  await agent
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'judge1', password: '1' })
    .expect(200);

  const res = await agent.get('/__judge-only').expect(200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.userId, 'u-judge-1');
});

test('__judge-only: police login only → 401', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/login').send({ username: 'officer1', password: '1' }).expect(200);

  await agent.get('/__judge-only').expect(401);
});
