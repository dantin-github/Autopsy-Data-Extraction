'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { serializeEventArgs } = require('../src/services/auditEventArgs');

test('serializeEventArgs maps fragment input names (ethers Result-like args)', () => {
  const ev = {
    fragment: {
      inputs: [
        { name: 'proposalId', type: 'bytes32' },
        { name: 'indexHash', type: 'bytes32' },
        { name: 'proposer', type: 'address' }
      ]
    },
    args: [`0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`, `0x${'cc'.repeat(20)}`]
  };
  const out = serializeEventArgs(ev);
  assert.strictEqual(out.proposalId, `0x${'aa'.repeat(32)}`);
  assert.strictEqual(out.indexHash, `0x${'bb'.repeat(32)}`);
  assert.strictEqual(out.proposer, `0x${'cc'.repeat(20)}`);
});

test('serializeEventArgs returns {} when fragment missing', () => {
  assert.deepStrictEqual(serializeEventArgs({ args: ['x'] }), {});
});
