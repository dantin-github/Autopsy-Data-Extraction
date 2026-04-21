'use strict';

/**
 * After POST /api/upload, builds e2e-propose-body.json (valid integrity + local/chain old hash path).
 * Requires e2e-query-body.json from gen-e2e-upload-body.js and the same RECORD_STORE_PATH as the gateway.
 *
 * Usage (from api-gateway): node scripts/gen-e2e-propose-body.js
 *
 * Second proposal for the same caseId: use a different note so newRecordHash changes, e.g.:
 *   set PROPOSE_NOTE=v3-second-proposal   (PowerShell: $env:PROPOSE_NOTE='v3-second-proposal')
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'gen-e2e-propose-placeholder';
}
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/services/recordStore')];

const integrity = require('../src/services/integrity');
const { getDefaultRecordStore } = require('../src/services/recordStore');

const root = path.join(__dirname, '..');
const queryPath = path.join(root, 'e2e-query-body.json');
if (!fs.existsSync(queryPath)) {
  console.error('Missing e2e-query-body.json — run: node scripts/gen-e2e-upload-body.js');
  process.exit(1);
}

const { caseId } = JSON.parse(fs.readFileSync(queryPath, 'utf8'));
const rs = getDefaultRecordStore();
const existing = rs.get(caseId);
if (existing == null) {
  console.error(
    `case ${caseId} not in record store — POST /api/upload first (RECORD_STORE_PATH must match this process: ${rs.storePath})`
  );
  process.exit(1);
}

const note = process.env.PROPOSE_NOTE || 'v2-e2e-modify';
const skeleton = JSON.stringify({
  caseId,
  examiner: 'officer1',
  aggregateHash: '',
  aggregateHashNote: note
});
const agg = integrity.computeHash(skeleton);
const caseJson = JSON.stringify({
  caseId,
  examiner: 'officer1',
  aggregateHash: agg,
  aggregateHashNote: note
});

const body = {
  caseId,
  caseJson,
  aggregateHash: agg,
  examiner: 'officer1',
  generatedAt: new Date().toISOString(),
  signingPassword: '1',
  reason: 'e2e P7.4 audit'
};

fs.writeFileSync(path.join(root, 'e2e-propose-body.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
console.log(`Wrote e2e-propose-body.json for caseId=${caseId} (aggregateHashNote=${note})`);
console.log(`record store: ${rs.storePath}`);
