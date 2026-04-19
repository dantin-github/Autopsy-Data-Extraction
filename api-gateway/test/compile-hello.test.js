'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

test('S4.1: compile HelloWorld.sol produces abi + bin (solc 0.5)', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'compile.js'), 'contracts/HelloWorld.sol'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);

  const abiPath = path.join(root, 'build', 'HelloWorld.abi');
  const binPath = path.join(root, 'build', 'HelloWorld.bin');
  assert.ok(fs.existsSync(abiPath), 'HelloWorld.abi missing');
  assert.ok(fs.existsSync(binPath), 'HelloWorld.bin missing');

  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  assert.ok(Array.isArray(abi));
  assert.ok(
    abi.some((x) => x.type === 'function' && x.name === 'sayHello'),
    'sayHello in ABI'
  );

  const bin = fs.readFileSync(binPath, 'utf8').trim();
  assert.match(bin, /^0x[0-9a-f]+$/i, 'bytecode hex');
  assert.ok(bin.length > 10, 'non-trivial bytecode');
});
