'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setTimeout: delay } = require('timers/promises');

let tokenStore;

beforeEach(() => {
  delete require.cache[require.resolve('../src/services/tokenStore')];
  tokenStore = require('../src/services/tokenStore');
  tokenStore.clear();
});

test('issue then consume returns userId once', () => {
  tokenStore.issue('u-1', 'tok-abc', 60_000);
  const a = tokenStore.consume('tok-abc');
  assert.deepStrictEqual(a, { userId: 'u-1' });
  const b = tokenStore.consume('tok-abc');
  assert.strictEqual(b, null);
});

test('consume unknown token returns null', () => {
  assert.strictEqual(tokenStore.consume('missing'), null);
});

test('second consume after successful consume is null (one-time)', () => {
  tokenStore.issue('u-2', 'once', 60_000);
  assert.ok(tokenStore.consume('once'));
  assert.strictEqual(tokenStore.consume('once'), null);
});

test('consume after TTL returns null', async () => {
  tokenStore.issue('u-3', 'expires', 100);
  await delay(220);
  assert.strictEqual(tokenStore.consume('expires'), null);
});

test('sweep removes expired without consume', async () => {
  tokenStore.issue('u-4', 'old', 50);
  await delay(120);
  tokenStore.sweep();
  assert.strictEqual(tokenStore.consume('old'), null);
});

test('issue throws on invalid ttl', () => {
  assert.throws(() => tokenStore.issue('u', 't', 0), /ttlMs/);
  assert.throws(() => tokenStore.issue('u', 't', -1), /ttlMs/);
});
