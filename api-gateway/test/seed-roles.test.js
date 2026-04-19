'use strict';

/**
 * S5.3: seed-roles.js --help and --keystore-only smoke (temp USERS_FILE / USERS_EXAMPLE_FILE).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert');

const apiRoot = path.join(__dirname, '..');
const scriptPath = path.join(apiRoot, 'scripts', 'seed-roles.js');
const keystore = require('../src/services/keystore');

test('S5.3: seed-roles --help exits 0', () => {
  const r = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: apiRoot,
    encoding: 'utf8'
  });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.ok(String(r.stdout || '').includes('Usage:'), 'expected Usage in stdout');
});

test('S5.3: seed-roles --keystore-only writes enc + onchainAddress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-roles-'));
  const uid = 'u-seed-roles-test';
  const passwordPlain = 'test-pass';

  const usersPath = path.join(tmp, 'users.json');
  const examplePath = path.join(tmp, 'users.example.json');

  fs.writeFileSync(
    path.join(tmp, 'users.json'),
    JSON.stringify(
      [
        {
          userId: uid,
          username: 't',
          role: 'police',
          passwordHash: '$2b$12$dummy'
        }
      ],
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmp, 'users.example.json'),
    JSON.stringify(
      [
        {
          userId: uid,
          username: 't',
          role: 'police',
          passwordPlain
        }
      ],
      null,
      2
    ),
    'utf8'
  );

  const encPath = path.join(apiRoot, 'data', 'keystore', `${uid}.enc`);
  try {
    if (fs.existsSync(encPath)) {
      fs.unlinkSync(encPath);
    }
  } catch (_) {
    /* ignore */
  }

  const r = spawnSync(process.execPath, [scriptPath, '--keystore-only'], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      USERS_FILE: usersPath,
      USERS_EXAMPLE_FILE: examplePath
    }
  });

  assert.strictEqual(r.status, 0, r.stderr || r.stdout);

  assert.ok(fs.existsSync(encPath), `expected ${encPath}`);
  const j = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  const pk = keystore.decrypt(j, passwordPlain);
  assert.ok(/^[0-9a-f]{64}$/.test(pk), 'decrypted private key');

  const usersOut = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  assert.strictEqual(usersOut.length, 1);
  assert.ok(/^0x[0-9a-f]{40}$/.test(usersOut[0].onchainAddress), 'onchainAddress');

  try {
    fs.unlinkSync(encPath);
  } catch (_) {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
