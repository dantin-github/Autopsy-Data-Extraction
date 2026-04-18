'use strict';

/**
 * Prints current block number via FISCO Channel (same source as console getBlockNumber).
 * Requires: conf from npm run copy-chain-certs, conf/accounts/gateway.pem, .env with SESSION_SECRET.
 * Usage (from api-gateway): npm run ping-chain
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'ping-chain-script-placeholder';
}

const chain = require('../src/services/chain');

(async () => {
  try {
    const n = await chain.getBlockNumber();
    console.log(String(n));
    process.exit(0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
