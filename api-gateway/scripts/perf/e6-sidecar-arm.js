'use strict';

/**
 * E6 sidecar · single-arm upload batch (fresh Node process — one gateway lifetime per invocation).
 *
 * Used by `e6-crud-vs-registry.js`. Do not run both arms in one process without restarting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  apiRoot,
  configurePerfEnv,
  acquirePoliceToken,
  uploadOnce,
  writeJsonl
} = require('./lib/harness');
const payload = require('./lib/payload');
const { residualUploadMs } = require('./lib/e2Aggregate');

function usage() {
  console.log(`
E6 sidecar — one arm only (run in a dedicated process).

Usage:
  node scripts/perf/e6-sidecar-arm.js --arm crud|registry [--run-id <hex>] [--out <jsonl>]
    [--record-store <json>] [--case-id-prefix <s>] [--measure <n>] [--warmup <n>] [--size 50KB]

Notes:
  - Warmup uploads are executed but NOT written to JSONL.
  - For arm crud: CHAIN_MODE=crud, UPLOAD_USE_CASE_REGISTRY=0. JSONL omits caseRegistryMs when the path was not invoked.
  - Record store path must be exclusive to this arm/run (see sidecar plan).
`);
}

function parseArgs(argv) {
  let arm = '';
  let runId = '';
  let outJsonl = '';
  let recordStore = '';
  let caseIdPrefix = '';
  let measure = 30;
  let warmup = 5;
  let sizeHuman = '50KB';
  let targetBytes = 50 * 1024;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--arm') {
      arm = String(argv[++i] || '').trim().toLowerCase();
    } else if (a === '--run-id') {
      runId = String(argv[++i] || '').trim();
    } else if (a === '--out') {
      outJsonl = path.resolve(String(argv[++i] || ''));
    } else if (a === '--record-store') {
      recordStore = path.resolve(String(argv[++i] || ''));
    } else if (a === '--case-id-prefix') {
      caseIdPrefix = String(argv[++i] || '');
    } else if (a === '--measure') {
      measure = Math.max(1, Number(argv[++i]));
    } else if (a === '--warmup') {
      warmup = Math.max(0, Number(argv[++i]));
    } else if (a === '--size') {
      sizeHuman = argv[++i];
      const m = /^(\d+)(kb|mb)$/i.exec(String(sizeHuman).trim());
      if (m) {
        const n = Number(m[1]);
        targetBytes = m[2].toLowerCase() === 'mb' ? n * 1024 * 1024 : n * 1024;
      } else {
        const num = Number(sizeHuman);
        if (Number.isFinite(num) && num >= 500) {
          targetBytes = num | 0;
        } else {
          throw new Error(`Invalid --size: ${sizeHuman}`);
        }
      }
    }
  }
  return {
    help: false,
    arm,
    runId,
    outJsonl,
    recordStore,
    caseIdPrefix,
    measure,
    warmup,
    targetBytes,
    sizeHuman
  };
}

/** @param {Record<string, unknown>} row */
function writeJsonlRow(destPath, row) {
  const copy = { ...row };
  for (const k of Object.keys(copy)) {
    if (copy[k] === undefined) {
      delete copy[k];
    }
  }
  writeJsonl(destPath, copy);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message || String(e));
    usage();
    process.exit(2);
    return;
  }
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }
  if (args.arm !== 'crud' && args.arm !== 'registry') {
    console.error('Required: --arm crud|registry');
    usage();
    process.exit(2);
    return;
  }
  if (!args.outJsonl) {
    console.error('Required: --out <jsonl>');
    process.exit(2);
    return;
  }
  if (!args.recordStore) {
    console.error('Required: --record-store <path>');
    process.exit(2);
    return;
  }

  const runId =
    args.runId || process.env.PERF_SIDECAR_RUN_ID || crypto.randomBytes(8).toString('hex');
  const caseIdPrefix =
    args.caseIdPrefix ||
    (args.arm === 'crud' ? `perf-sidecar-crud-${runId}-` : `perf-sidecar-reg-${runId}-`);

  fs.mkdirSync(path.dirname(args.recordStore), { recursive: true });
  if (fs.existsSync(args.recordStore)) {
    fs.unlinkSync(args.recordStore);
  }

  fs.mkdirSync(path.dirname(args.outJsonl), { recursive: true });
  if (fs.existsSync(args.outJsonl)) {
    fs.unlinkSync(args.outJsonl);
  }

  const overrides = {
    RECORD_STORE_PATH: args.recordStore,
    CHAIN_MODE: args.arm === 'crud' ? 'crud' : 'contract',
    ...(args.arm === 'crud' ? { UPLOAD_USE_CASE_REGISTRY: '0' } : {})
  };
  configurePerfEnv(overrides);

  const isoStartWall = new Date().toISOString();
  console.log(
    `[E6 sidecar arm=${args.arm}] pid=${process.pid} runId=${runId} recordStore=${args.recordStore} out=${args.outJsonl} warmup=${args.warmup} measure=${args.measure} size=${args.sizeHuman}`
  );
  console.log(`[E6 sidecar arm=${args.arm}] wallStartUtc=${isoStartWall}`);

  const policeToken = await acquirePoliceToken();

  /** @param {number} index */
  async function oneUpload(index, includeInJsonl) {
    const caseId = `${caseIdPrefix}${index}`;
    const generatedAt = new Date().toISOString();
    const { caseJson, aggregateHash, utf8Len } = payload.genAt(args.targetBytes, caseId);

    const r = await uploadOnce(policeToken, {
      caseId,
      examiner: 'officer1',
      aggregateHash,
      generatedAt,
      caseJson
    });

    let ok = Boolean(
      r.httpStatus === 200 && r.body && r.body.txHash && r.body.timing != null
    );
    const tim = ok ? r.body.timing : {};
    const integrityMs = ok ? Number(tim.integrityMs) : null;
    const localHashMs =
      ok && Number.isFinite(tim.localHashMs) ? Number(tim.localHashMs) : null;
    const recordStoreMs =
      ok && Number.isFinite(tim.recordStoreMs) ? Number(tim.recordStoreMs) : null;
    const chainMs = ok ? Number(tim.chainMs) : null;

    /** CRUD timing object omits caseRegistryMs — do not coerce to zero in raw JSONL */
    let caseRegistryMs = null;
    if (args.arm === 'registry') {
      caseRegistryMs =
        ok && tim.caseRegistryMs != null && Number.isFinite(Number(tim.caseRegistryMs))
          ? Number(tim.caseRegistryMs)
          : null;
    }

    let totalMs = ok ? Number(tim.totalMs) : null;
    let residualMs = null;
    const regForResidual = Number.isFinite(caseRegistryMs) ? caseRegistryMs : 0;
    if (ok && Number.isFinite(totalMs) && Number.isFinite(integrityMs) && Number.isFinite(chainMs)) {
      residualMs = residualUploadMs({
        ok: true,
        totalMs,
        integrityMs,
        localHashMs,
        recordStoreMs,
        chainMs,
        caseRegistryMs: regForResidual
      });
    }

    let chainBlockNum =
      ok && r.body.blockNumber != null ? Number(r.body.blockNumber) : null;
    let regBlockNum =
      ok && r.body.caseRegistryBlockNumber != null
        ? Number(r.body.caseRegistryBlockNumber)
        : null;

    const row = {
      experiment: 'E6-sidecar',
      arm: args.arm,
      registryPathInvoked: args.arm === 'registry',
      i: index,
      ts: generatedAt,
      runId,
      caseId,
      httpStatus: r.httpStatus,
      ok,
      utf8Approx: utf8Len,
      integrityMs,
      localHashMs,
      recordStoreMs,
      chainMs,
      totalMs,
      residualMs,
      clientRoundTripMs: r.clientRoundTripMs,
      requestId:
        ok && r.body.requestId != null ? String(r.body.requestId) : '',
      txHash: r.body && r.body.txHash ? r.body.txHash : null,
      blockNumber: chainBlockNum,
      caseRegistryBlockNumber: regBlockNum,
      recordStorePath: args.recordStore,
      bodyError: ok ? null : r.body ? JSON.stringify(r.body) : 'no-json'
    };

    if (args.arm === 'registry' && caseRegistryMs != null) {
      row.caseRegistryMs = caseRegistryMs;
    }

    if (includeInJsonl) {
      writeJsonlRow(args.outJsonl, row);
    }
    return row;
  }

  for (let w = 0; w < args.warmup; w++) {
    const row = await oneUpload(`w${w}`, false);
    if (!row.ok) {
      console.error(`[E6 sidecar warmup] failed at warmup step ${w}: ${row.bodyError}`);
      process.exit(3);
      return;
    }
  }

  const logicalMeasured = [];
  for (let m = 0; m < args.measure; m++) {
    const row = await oneUpload(m, true);
    logicalMeasured.push(row);
    if (!row.ok) {
      console.error(`[E6 sidecar] measured iteration ${m} failed`);
      process.exit(3);
      return;
    }
  }

  console.log(`[E6 sidecar arm=${args.arm}] done · measured=${logicalMeasured.length} jsonl=${args.outJsonl}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
