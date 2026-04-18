'use strict';

/**
 * Business-style chain verification: look up t_case_hash by record_hash (value column)
 * and print whether the on-chain row exists (same path as /api/query will use for chain side).
 *
 * Usage (from api-gateway):
 *   node scripts/verify-record-hash.js
 *   node scripts/verify-record-hash.js 0x7ac537786088963fc39c3e9901ae2fbb91a4380ddfad6ae10f93c26f6ae6358b
 *
 * Requires: conf/fisco-config.json, conf/accounts/gateway.pem, .env with SESSION_SECRET
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'verify-record-hash-placeholder';
}

const chain = require('../src/services/chain');

const DEFAULT_RECORD_HASH =
  '0x7ac537786088963fc39c3e9901ae2fbb91a4380ddfad6ae10f93c26f6ae6358b';

(async () => {
  const recordHash = (process.argv[2] || DEFAULT_RECORD_HASH).trim();

  if (!chain.isChainConfigured()) {
    console.error(chain.getChainConfigGaps().join('\n'));
    process.exit(1);
  }

  const sel = await chain.selectRecord(recordHash);
  if (!sel.recordHash) {
    console.log(JSON.stringify({ ok: false, reason: 'not_found_on_chain', recordHash }, null, 2));
    process.exit(2);
  }

  const onChain = String(sel.recordHash).toLowerCase();
  const expected = recordHash.startsWith('0x') || recordHash.startsWith('0X')
    ? recordHash.toLowerCase()
    : `0x${recordHash.toLowerCase()}`;

  const match =
    onChain.replace(/^0x/, '') === expected.replace(/^0x/, '');

  console.log(
    JSON.stringify(
      {
        ok: match,
        recordHash: expected,
        onChainRecordHash: sel.recordHash,
        rows: sel.rows
      },
      null,
      2
    )
  );
  process.exit(match ? 0 : 3);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
