'use strict';

/**
 * E2.1: verify five size tiers (10K / 100K / 1M / 5M / 10M) with genAtBand ±5% and integrity.verify.
 * Optional: one real POST /api/upload per tier (--upload) when chain + gateway are available.
 *
 * Usage (from api-gateway):
 *   npm run perf:e2:payload-sanity
 *   node scripts/perf/e2-tier-payload-sanity.js [--upload] [--tol 0.05]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const payload = require('./lib/payload');
const { configurePerfEnv, acquirePoliceToken, uploadOnce } = require('./lib/harness');

const TOL = 0.05;

function parseArgs(argv) {
  let upload = false;
  let tol = TOL;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--upload') {
      upload = true;
    } else if (argv[i] === '--tol') {
      tol = Number(argv[++i]);
    }
  }
  return { upload, tol };
}

function inBand(utf8Len, target, tol) {
  const lo = target * (1 - tol);
  const hi = target * (1 + tol);
  return utf8Len >= lo && utf8Len <= hi;
}

async function main() {
  const { upload, tol } = parseArgs(process.argv);
  if (!Number.isFinite(tol) || tol <= 0 || tol >= 0.5) {
    console.error('Invalid --tol');
    process.exit(2);
    return;
  }

  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(4).toString('hex');
  const rsFile = path.join(os.tmpdir(), `perf-e2-tier-sanity-${runId}-${process.pid}.json`);
  configurePerfEnv({ RECORD_STORE_PATH: rsFile });

  const token = upload ? await acquirePoliceToken() : null;

  for (const tier of payload.E2_TIER_ORDER) {
    const targetBytes = payload.E2_TIER_BYTES[tier];
    const caseId = `perf-e2-tier-${tier}-${runId}`;
    const t0 = Date.now();
    const { caseJson, aggregateHash, utf8Len } = payload.genAtBand(targetBytes, caseId, tol);
    const dt = Date.now() - t0;

    if (!inBand(utf8Len, targetBytes, tol)) {
      console.error(`E2.1 ${tier}: utf8Len ${utf8Len} outside ±${(tol * 100).toFixed(0)}% of ${targetBytes}`);
      process.exit(3);
    }

    const pct = ((utf8Len / targetBytes) * 100 - 100).toFixed(2);
    console.log(
      `E2.1 ${tier}: target=${targetBytes} utf8=${utf8Len} delta=${pct}% integrity=ok genMs=${dt}`
    );

    if (upload) {
      const r = await uploadOnce(token, {
        caseId,
        aggregateHash,
        generatedAt: new Date().toISOString(),
        caseJson
      });
      if (r.httpStatus !== 200 || !r.body || !r.body.txHash) {
        console.error(`E2.1 ${tier}: upload failed status=${r.httpStatus} body=${JSON.stringify(r.body)}`);
        process.exit(4);
      }
      console.log(`E2.1 ${tier}: upload ok tx=${r.body.txHash}`);
    }
  }

  try {
    if (fs.existsSync(rsFile)) {
      fs.unlinkSync(rsFile);
    }
  } catch (_) {}
  console.log(upload ? 'E2.1 tier sanity (local + upload) done.' : 'E2.1 tier sanity (local only) done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
