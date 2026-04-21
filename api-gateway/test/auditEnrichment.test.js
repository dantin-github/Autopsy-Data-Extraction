'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { coerceEvmAddress } = require('../src/services/auditEnrichment');

test('coerceEvmAddress: 20-byte hex', () => {
  assert.strictEqual(
    coerceEvmAddress('0x69cBbF354D8A41606a7266DE62A2c9c23A14B16a'),
    '0x69cbbf354d8a41606a7266de62a2c9c23a14b16a'
  );
});

test('coerceEvmAddress: 32-byte padded word', () => {
  assert.strictEqual(
    coerceEvmAddress('0x00000000000000000000000069cbbf354d8a41606a7266de62a2c9c23a14b16a'),
    '0x69cbbf354d8a41606a7266de62a2c9c23a14b16a'
  );
});

test('coerceEvmAddress: invalid', () => {
  assert.strictEqual(coerceEvmAddress('0x1234'), null);
  assert.strictEqual(coerceEvmAddress(null), null);
});
