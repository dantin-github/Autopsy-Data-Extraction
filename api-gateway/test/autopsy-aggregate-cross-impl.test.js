'use strict';

/**
 * Cross-implementation fixture for Autopsy aggregateHash vs gateway integrity.computeHash.
 * Java CanonicalJsonTest (S1.2) must reproduce expectedGatewayAggregateHash for each caseJson.
 */

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const integrity = require('../src/services/integrity');

const FIXTURE = path.join(__dirname, 'fixtures', 'autopsy-aggregate-samples.jsonl');

test('autopsy-aggregate fixtures: every line matches integrity.computeHash', () => {
  const raw = fs.readFileSync(FIXTURE, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  assert.ok(lines.length >= 10, 'expected at least 10 samples (S1.2)');

  for (let i = 0; i < lines.length; i++) {
    const row = JSON.parse(lines[i]);
    const { id, caseJson, expectedGatewayAggregateHash, canonicalUtf8Base64 } = row;
    const computed = integrity.computeHash(caseJson);
    assert.strictEqual(
      computed,
      expectedGatewayAggregateHash,
      `sample ${i} (${id}): aggregate hash mismatch`
    );

    if (canonicalUtf8Base64 != null && canonicalUtf8Base64 !== '') {
      const canon = canonicalJsonString(caseJson);
      const b64 = Buffer.from(canon, 'utf8').toString('base64');
      assert.strictEqual(
        b64,
        canonicalUtf8Base64,
        `sample ${i} (${id}): canonical UTF-8 base64 mismatch`
      );
    }

    const withStored = JSON.parse(caseJson);
    withStored.aggregateHash = expectedGatewayAggregateHash;
    withStored.aggregateHashNote = 'fixture';
    assert.strictEqual(integrity.verify(JSON.stringify(withStored)), true);
  }
});

function sortKeysDeep(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const sorted = {};
  for (const k of Object.keys(value).sort()) {
    sorted[k] = sortKeysDeep(value[k]);
  }
  return sorted;
}

function canonicalJsonString(caseJson) {
  const j = JSON.parse(caseJson);
  j.aggregateHash = '';
  j.aggregateHashNote = '';
  return JSON.stringify(sortKeysDeep(j));
}
