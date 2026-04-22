'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const integrity = require('../src/services/integrity');

/** Same base as IntegrityVerifier.java main "test" branch (fields empty before signing). */
const BASE_EMPTY_HASH_FIELDS =
  '{"caseId":"TEST-2025-001","examiner":"police","aggregateHash":"","aggregateHashNote":""}';

/** SHA-256 of MapSortField canonical form (sorted keys), hash fields cleared — matches Java IntegrityVerifier. */
const EXPECTED_COMPUTE_HASH =
  'bee2393f2d6ac949e47eab0f6a7e04d6eb1747f5c59905d98f4983adbd4a1789';

test('computeHash matches Java IntegrityVerifier (MapSortField canonical JSON)', () => {
  assert.strictEqual(integrity.computeHash(BASE_EMPTY_HASH_FIELDS), EXPECTED_COMPUTE_HASH);
});

test('verify succeeds when aggregateHash equals computeHash of body', () => {
  const signed = JSON.stringify({
    caseId: 'TEST-2025-001',
    examiner: 'police',
    aggregateHash: EXPECTED_COMPUTE_HASH,
    aggregateHashNote: 'SHA-256 of body'
  });
  assert.strictEqual(integrity.verify(signed), true);
});

test('verify fails on wrong hash or missing aggregateHash', () => {
  const bad = JSON.stringify({
    caseId: 'TEST-2025-001',
    examiner: 'police',
    aggregateHash: 'deadbeef',
    aggregateHashNote: ''
  });
  assert.strictEqual(integrity.verify(bad), false);

  const noHash = JSON.stringify({
    caseId: 'X',
    examiner: 'police',
    aggregateHash: '',
    aggregateHashNote: ''
  });
  assert.strictEqual(integrity.verify(noHash), false);
});

test('nested objects: keys sorted at each depth', () => {
  const nested = JSON.stringify({
    z: 1,
    a: { m: 2, b: 1 },
    aggregateHash: '',
    aggregateHashNote: ''
  });
  const h = integrity.computeHash(nested);
  assert.strictEqual(typeof h, 'string');
  assert.strictEqual(h.length, 64);
});

test('S4.4: uploadStatus / uploadDetail ignored for computeHash and verify', () => {
  const withUpload = JSON.stringify({
    caseId: 'TEST-2025-001',
    examiner: 'police',
    aggregateHash: EXPECTED_COMPUTE_HASH,
    aggregateHashNote: 'SHA-256 of body',
    uploadStatus: 'success',
    uploadDetail: { txHash: '0xabc', blockNumber: 1 }
  });
  assert.strictEqual(integrity.computeHash(withUpload), EXPECTED_COMPUTE_HASH);
  assert.strictEqual(integrity.verify(withUpload), true);
});

test('S4.5: uploadStatus cancelled still verifies', () => {
  const doc = JSON.stringify({
    caseId: 'TEST-2025-001',
    examiner: 'police',
    aggregateHash: EXPECTED_COMPUTE_HASH,
    aggregateHashNote: 'SHA-256 of body',
    uploadStatus: 'cancelled',
    uploadDetail: { reason: 'user_cancelled', clientRoundTripMs: 50 }
  });
  assert.strictEqual(integrity.verify(doc), true);
});
