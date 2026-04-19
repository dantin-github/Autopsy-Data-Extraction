'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

test('S5.1: deploy-contract.js --help exits 0', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'deploy-contract.js'), '--help'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.ok((r.stdout || '').includes('deploy-contract'), 'usage text');
});
