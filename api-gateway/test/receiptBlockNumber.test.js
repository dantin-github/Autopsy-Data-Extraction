'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseReceiptBlockNumber } = require('../src/services/receiptBlockNumber');

test('parseReceiptBlockNumber: 0x hex', () => {
  assert.strictEqual(parseReceiptBlockNumber('0x323'), 803);
  assert.strictEqual(parseReceiptBlockNumber('0x01'), 1);
});

test('parseReceiptBlockNumber: decimal string', () => {
  assert.strictEqual(parseReceiptBlockNumber('803'), 803);
  assert.strictEqual(parseReceiptBlockNumber('630'), 630);
});

test('parseReceiptBlockNumber: finite number', () => {
  assert.strictEqual(parseReceiptBlockNumber(803), 803);
});

test('parseReceiptBlockNumber: empty → 0', () => {
  assert.strictEqual(parseReceiptBlockNumber(null), 0);
  assert.strictEqual(parseReceiptBlockNumber(''), 0);
});
