'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

test('S4.2: compile CaseRegistry.sol — ABI 11 functions, 5 events', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'compile.js'), 'contracts/CaseRegistry.sol'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);

  const abiPath = path.join(root, 'build', 'CaseRegistry.abi');
  const binPath = path.join(root, 'build', 'CaseRegistry.bin');
  assert.ok(fs.existsSync(abiPath), 'CaseRegistry.abi missing');
  assert.ok(fs.existsSync(binPath), 'CaseRegistry.bin missing');

  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  assert.ok(Array.isArray(abi));

  const functions = abi.filter((x) => x.type === 'function');
  assert.strictEqual(functions.length, 11, `expected 11 functions, got ${functions.length}`);

  const names = new Set(functions.map((f) => f.name).sort());
  const expected = new Set([
    'addJudge',
    'addPolice',
    'approve',
    'createRecord',
    'execute',
    'getProposal',
    'getRecordHash',
    'judges',
    'police',
    'propose',
    'reject'
  ]);
  assert.deepStrictEqual(names, expected);

  const events = abi.filter((x) => x.type === 'event');
  assert.strictEqual(events.length, 5, `expected 5 events, got ${events.length}`);
  const eventNames = new Set(events.map((e) => e.name).sort());
  assert.deepStrictEqual(
    eventNames,
    new Set([
      'ProposalApproved',
      'ProposalCreated',
      'ProposalExecuted',
      'ProposalRejected',
      'RecordCreated'
    ])
  );

  const bin = fs.readFileSync(binPath, 'utf8').trim();
  assert.match(bin, /^0x[0-9a-f]+$/i, 'bytecode hex');
  assert.ok(bin.length > 10, 'non-trivial bytecode');
});
