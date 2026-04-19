'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const keystore = require('../src/services/keystore');

test('S5.2: encrypt → decrypt restores private key', () => {
  const kp = keystore.generateKeypair();
  const blob = keystore.encrypt(kp.privateKey, 'correct-horse-battery-staple');
  const out = keystore.decrypt(blob, 'correct-horse-battery-staple');
  assert.strictEqual(out, kp.privateKey);
});

test('S5.2: wrong password throws BadPassword', () => {
  const kp = keystore.generateKeypair();
  const blob = keystore.encrypt(kp.privateKey, 'secret-a');
  assert.throws(
    () => keystore.decrypt(blob, 'secret-b'),
    (err) => err instanceof keystore.BadPassword || err.name === 'BadPassword'
  );
});

test('S5.2: same key + password yields different ciphertext (salt/iv)', () => {
  const pk = keystore.generateKeypair().privateKey;
  const a = keystore.encrypt(pk, 'same-password');
  const b = keystore.encrypt(pk, 'same-password');
  assert.notDeepStrictEqual(a, b);
  assert.notStrictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.ciphertext, b.ciphertext);
  assert.strictEqual(keystore.decrypt(a, 'same-password'), pk);
  assert.strictEqual(keystore.decrypt(b, 'same-password'), pk);
});

test('S5.2: decrypt accepts JSON string payload', () => {
  const kp = keystore.generateKeypair();
  const blob = keystore.encrypt(kp.privateKey, 'x');
  const json = JSON.stringify(blob);
  assert.strictEqual(keystore.decrypt(json, 'x'), kp.privateKey);
});
