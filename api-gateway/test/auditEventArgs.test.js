'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { serializeEventArgs } = require('../src/services/auditEventArgs');

const sig = 'ProposalCreated(bytes32,bytes32,address)';

const mockIface = {
  events: {
    [sig]: {
      inputs: [
        { name: 'proposalId', type: 'bytes32' },
        { name: 'indexHash', type: 'bytes32' },
        { name: 'proposer', type: 'address' }
      ]
    }
  }
};

test('serializeEventArgs: ethers LogDescription uses values + iface.events[sig].inputs', () => {
  const ev = {
    name: 'ProposalCreated',
    signature: sig,
    values: [`0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`, `0x${'cc'.repeat(20)}`]
  };
  const out = serializeEventArgs(mockIface, ev);
  assert.strictEqual(out.proposalId, `0x${'aa'.repeat(32)}`);
  assert.strictEqual(out.indexHash, `0x${'bb'.repeat(32)}`);
  assert.strictEqual(out.proposer, `0x${'cc'.repeat(20)}`);
});

test('serializeEventArgs: named keys on Result-like values', () => {
  const ev = {
    signature: sig,
    values: {
      0: `0x${'dd'.repeat(32)}`,
      1: `0x${'ee'.repeat(32)}`,
      2: `0x${'ff'.repeat(20)}`,
      length: 3,
      proposalId: `0x${'dd'.repeat(32)}`,
      indexHash: `0x${'ee'.repeat(32)}`,
      proposer: `0x${'ff'.repeat(20)}`
    }
  };
  const out = serializeEventArgs(mockIface, ev);
  assert.strictEqual(out.proposalId, `0x${'dd'.repeat(32)}`);
});

test('serializeEventArgs returns {} when signature unknown to iface', () => {
  const ev = {
    signature: 'Unknown(bytes32)',
    values: ['0x01']
  };
  assert.deepStrictEqual(serializeEventArgs(mockIface, ev), {});
});
