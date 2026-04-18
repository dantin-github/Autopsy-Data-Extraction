'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const { createRecordStore } = require('../src/services/recordStore');

const JAVA_FIXTURE = path.join(__dirname, 'fixtures', 'java-case_record_store.json');

function tmpStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crs-')), 'store.json');
}

test('save(caseId, fields) then get roundtrip', () => {
  const storePath = tmpStorePath();
  const store = createRecordStore({ storePath });
  const caseJson = '{"caseId":"X","n":1}';
  store.save('CASE-A', caseJson, 'agg1', 'ex1', '2025-01-01 00:00:00');
  const got = store.get('CASE-A');
  assert.ok(got);
  const o = JSON.parse(got);
  assert.strictEqual(o.case_id, 'CASE-A');
  assert.strictEqual(o.case_json, caseJson);
  assert.strictEqual(o.aggregate_hash, 'agg1');
  assert.strictEqual(o.examiner, 'ex1');
  assert.strictEqual(o.created_at, '2025-01-01 00:00:00');
  assert.strictEqual(store.exists('CASE-A'), true);
  assert.strictEqual(store.exists('missing'), false);
});

test('5-arg save is identical to 2-arg with the same fullRecordJson', () => {
  const storePath = tmpStorePath();
  const s = createRecordStore({ storePath });
  s.save('K', '{"x":1}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'e', 't');
  const g1 = s.get('K');
  const p = tmpStorePath();
  const s2 = createRecordStore({ storePath: p });
  s2.save('K', g1);
  assert.strictEqual(createRecordStore({ storePath: p }).get('K'), g1);
});

test('Java CaseRecordStore file: Node reads same fullRecord string', () => {
  let raw;
  try {
    raw = fs.readFileSync(JAVA_FIXTURE, 'utf8');
  } catch (e) {
    assert.fail(
      'Missing test/fixtures/java-case_record_store.json — run: npm run generate-record-store-fixture'
    );
  }
  const outer = JSON.parse(raw);
  const caseId = 'TEST-2025-001';
  assert.ok(Object.prototype.hasOwnProperty.call(outer, caseId));
  const expectedInner = outer[caseId];

  const storePath = tmpStorePath();
  fs.writeFileSync(storePath, raw, 'utf8');
  const store = createRecordStore({ storePath });
  assert.strictEqual(store.get(caseId), expectedInner);

  const parsed = JSON.parse(expectedInner);
  const hashOnly = require('../src/services/hashOnly');
  const rh = hashOnly.computeRecordHash(
    parsed.case_id,
    parsed.case_json,
    parsed.aggregate_hash,
    parsed.examiner,
    parsed.created_at
  );
  assert.strictEqual(typeof rh, 'string');
  assert.strictEqual(rh.length, 64);
});

test('Node write then read (fresh file)', () => {
  const storePath = tmpStorePath();
  const store = createRecordStore({ storePath });
  store.save(
    'N-1',
    '{"k":1}',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'police',
    '2025-06-06 06:06:06'
  );
  const again = createRecordStore({ storePath });
  const g = again.get('N-1');
  assert.ok(g);
  assert.strictEqual(JSON.parse(g).case_id, 'N-1');
});
