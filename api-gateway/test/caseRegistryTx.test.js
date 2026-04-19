'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { toBytes32 } = require('../src/services/caseRegistryTx');

test('S5.4: toBytes32 accepts 64 hex chars with or without 0x', () => {
  const h = 'aa'.repeat(32);
  assert.strictEqual(toBytes32(h), `0x${h}`);
  assert.strictEqual(toBytes32(`0x${h}`), `0x${h}`);
});

test('S5.4: toBytes32 rejects bad input', () => {
  assert.throws(() => toBytes32('short'), /expected 32-byte/);
  assert.throws(() => toBytes32(`${'aa'.repeat(32)}ff`), /expected 32-byte/);
});
