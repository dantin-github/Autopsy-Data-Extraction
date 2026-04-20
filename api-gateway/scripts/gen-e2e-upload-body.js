'use strict';

/**
 * Writes e2e-upload-body.json + e2e-query-body.json with a fresh caseId and valid integrity.
 * Usage (from api-gateway): node scripts/gen-e2e-upload-body.js
 */

const fs = require('fs');
const path = require('path');
const integrity = require('../src/services/integrity');

const caseId = `e2e-${Date.now()}`;
const skeleton = JSON.stringify({
  caseId,
  examiner: 'officer1',
  aggregateHash: '',
  aggregateHashNote: 'SHA-256 of body'
});
const agg = integrity.computeHash(skeleton);
const caseJson = JSON.stringify({
  caseId,
  examiner: 'officer1',
  aggregateHash: agg,
  aggregateHashNote: 'SHA-256 of body'
});

// signingPassword: required when CHAIN_MODE=contract + CASE_REGISTRY_ADDR (same as seed-roles keystore password).
const uploadBody = {
  caseId,
  examiner: 'officer1',
  aggregateHash: agg,
  generatedAt: new Date().toISOString(),
  caseJson,
  signingPassword: '1'
};

const root = path.join(__dirname, '..');
fs.writeFileSync(
  path.join(root, 'e2e-upload-body.json'),
  `${JSON.stringify(uploadBody, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(root, 'e2e-query-body.json'),
  `${JSON.stringify({ caseId }, null, 2)}\n`,
  'utf8'
);

console.log(`caseId=${caseId}`);
console.log('Wrote e2e-upload-body.json and e2e-query-body.json');
