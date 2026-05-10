'use strict';

/**
 * E4.1: chainMock.install → insertRecord wall under 1 ms; restore → real getBlockNumber > 0.
 *
 * Usage (api-gateway root): node scripts/perf/lib/chainMock.sanity.js
 */

const path = require('path');

const { configurePerfEnv } = require('./harness');

const apiRoot = path.join(__dirname, '..', '..', '..');
require('dotenv').config({ path: path.join(apiRoot, '.env') });

configurePerfEnv();

const chain = require(path.join(apiRoot, 'src', 'services', 'chain'));
const mock = require('./chainMock');

const INDEX = `0x${'11'.repeat(32)}`;
const RECORD = `0x${'22'.repeat(32)}`;

async function main() {
  if (!chain.isChainConfigured()) {
    console.error('FAIL · chain not configured (run perf:precheck)');
    process.exit(1);
    return;
  }

  mock.install();
  const t0 = process.hrtime.bigint();
  await chain.insertRecord({ indexHash: INDEX, recordHash: RECORD });
  const micros = Number(process.hrtime.bigint() - t0) / 1000;
  mock.restore();

  if (micros >= 1000) {
    console.error(`FAIL · mock insertRecord took ${micros.toFixed(0)}µs (need < 1 ms)`);
    process.exit(1);
    return;
  }

  const bn = await chain.getBlockNumber();
  const n = Number(bn);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`FAIL · getBlockNumber after restore: ${bn}`);
    process.exit(1);
    return;
  }

  console.log(`OK · chainMock.sanity mock_insert=${micros.toFixed(0)}µs block=${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
