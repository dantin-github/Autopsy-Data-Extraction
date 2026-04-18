'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-for-userstore';

const { test, before } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

before(() => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed-users.js')], {
    cwd: root,
    stdio: 'inherit'
  });
  assert.strictEqual(r.status, 0);
  delete require.cache[require.resolve('../src/services/userStore')];
});

test('verifyCredentials accepts correct password', async () => {
  const userStore = require('../src/services/userStore');
  userStore.clearCache();
  const u = await userStore.verifyCredentials('officer1', '1');
  assert.ok(u);
  assert.strictEqual(u.userId, 'u-police-1');
  assert.strictEqual(u.role, 'police');
  assert.strictEqual(u.passwordHash, undefined);
});

test('verifyCredentials rejects wrong password', async () => {
  const userStore = require('../src/services/userStore');
  userStore.clearCache();
  const u = await userStore.verifyCredentials('officer1', 'not-the-password');
  assert.strictEqual(u, null);
});

test('verifyCredentials rejects unknown user', async () => {
  const userStore = require('../src/services/userStore');
  userStore.clearCache();
  const u = await userStore.verifyCredentials('nope', '1');
  assert.strictEqual(u, null);
});
