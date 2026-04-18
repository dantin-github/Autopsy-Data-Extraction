'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const hashOnly = require('../src/services/hashOnly');

/** Same inputs as blockchain HashOnlyDemo.java */
const DEMO = {
  caseId: 'TEST-2025-001',
  caseJson:
    '{"caseId":"TEST-2025-001","examiner":"police","aggregateHash":"abc123","aggregateHashNote":""}',
  aggregateHash: 'abc123',
  examiner: 'police',
  createdAt: '2025-03-10 10:00:00'
};

const EXPECTED_INDEX = '2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae';
const EXPECTED_RECORD = '22921f46a2311a643303665896f08685d26d7cbf218ae56ff2e4b4ea1d834ab0';

test('computeIndexHash matches Java / HASH-ONLY-EXAMPLE fixture', () => {
  assert.strictEqual(hashOnly.computeIndexHash(DEMO.caseId), EXPECTED_INDEX);
});

test('computeRecordHash matches Java HashOnlyDemo', () => {
  assert.strictEqual(
    hashOnly.computeRecordHash(
      DEMO.caseId,
      DEMO.caseJson,
      DEMO.aggregateHash,
      DEMO.examiner,
      DEMO.createdAt
    ),
    EXPECTED_RECORD
  );
});

test('computeRecordHashFromJson matches full record JSON', () => {
  const full = JSON.stringify({
    case_id: DEMO.caseId,
    case_json: DEMO.caseJson,
    aggregate_hash: DEMO.aggregateHash,
    examiner: DEMO.examiner,
    created_at: DEMO.createdAt
  });
  assert.strictEqual(hashOnly.computeRecordHashFromJson(full), EXPECTED_RECORD);
});

test('verifyRecordHash is case-insensitive on chain hash', () => {
  const full = JSON.stringify({
    case_id: DEMO.caseId,
    case_json: DEMO.caseJson,
    aggregate_hash: DEMO.aggregateHash,
    examiner: DEMO.examiner,
    created_at: DEMO.createdAt
  });
  assert.strictEqual(hashOnly.verifyRecordHash(full, EXPECTED_RECORD.toUpperCase()), true);
  assert.strictEqual(hashOnly.verifyRecordHash(full, 'deadbeef'), false);
});

test('null fields treated as empty strings like Java', () => {
  const h = hashOnly.computeRecordHash(null, null, null, null, null);
  const o = { case_id: '', case_json: '', aggregate_hash: '', examiner: '', created_at: '' };
  assert.strictEqual(h, hashOnly.computeRecordHash('', '', '', '', ''));
  assert.strictEqual(h, hashOnly.computeRecordHashFromJson(JSON.stringify(o)));
});
