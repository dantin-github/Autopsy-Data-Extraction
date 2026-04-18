'use strict';

/**
 * S3.3 smoke: insert + select on t_case_hash; prints txHash and verifies record_hash round-trip.
 * Requires: conf from npm run copy-chain-certs, conf/accounts/gateway.pem, .env with SESSION_SECRET.
 * Usage (from api-gateway): npm run crud-smoke
 */

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'crud-smoke-script-placeholder';
}

const chain = require('../src/services/chain');

function randomHexHash() {
  return crypto.randomBytes(32).toString('hex');
}

(async () => {
  if (!chain.isChainConfigured()) {
    console.error(chain.getChainConfigGaps().join('\n'));
    process.exit(1);
  }

  const indexHash = randomHexHash();
  const recordHash = randomHexHash();

  const ins = await chain.insertRecord({ indexHash, recordHash });
  if (!/^0x[0-9a-f]{64}$/i.test(ins.txHash)) {
    throw new Error(`unexpected txHash: ${ins.txHash}`);
  }
  console.log('txHash', ins.txHash);

  const sel = await chain.selectRecord(recordHash);
  const got = sel.recordHash
    ? String(sel.recordHash).replace(/^0x/i, '').toLowerCase()
    : '';
  if (got !== recordHash.toLowerCase()) {
    console.error('select mismatch', { expected: recordHash, got: sel.recordHash, rows: sel.rows });
    process.exit(1);
  }
  console.log('record_hash', sel.recordHash);
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
