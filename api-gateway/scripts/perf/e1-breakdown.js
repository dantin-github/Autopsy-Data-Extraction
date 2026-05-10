'use strict';

/**
 * E1: latency breakdown — sequential POST /api/upload with X-Debug-Timing.
 *
 * Usage:
 *   npm run perf:e1 -- [options]
 *   node scripts/perf/e1-breakdown.js [--iters 100] [--size 50KB] [--out <jsonl>]
 *   node scripts/perf/e1-breakdown.js --smoke   # plan E1.2 (5 × 50KB, tmp JSONL + gates)
 *   node scripts/perf/e1-breakdown.js --gates-e13 # plan E1.3 (100 × 50KB, canonical JSONL, wall & monotonic gates)
 *   Report path: docs/evidence/perf/results/e1-breakdown.md (E1.5, seven-section skeleton, matches E1.4 CSV summary)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  apiRoot,
  configurePerfEnv,
  acquirePoliceToken,
  uploadOnce,
  writeJsonl
} = require('./lib/harness');

const payload = require('./lib/payload');
const {
  buildE1CsvLines,
  verifyTotalMsP50Tolerance,
  printE1StackedBarStdout,
  writeE1BreakdownMarkdownFile
} = require('./lib/e1Aggregate');
const { residualUploadMs } = require('./lib/e2Aggregate');

const workspaceRoot = path.join(apiRoot, '..');
const defaultResultDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaultE1JsonlDir = path.join(defaultResultDir, 'E1');
const defaultE1JsonlPath = path.join(defaultE1JsonlDir, 'e1-breakdown.jsonl');

function usage() {
  console.log(`
E1 latency breakdown

Usage:
  npm run perf:e1 -- [options]
  node scripts/perf/e1-breakdown.js [options]

Options:
  --iters <n>    Upload count (default 100)
  --size <sx>    Target UTF-8 caseJson size e.g. 50KB or 524288 (default 50KB)
  --out <file>   JSONL path (default docs/evidence/perf/results/E1/e1-breakdown.jsonl)
  --no-report    Skip CSV + Markdown report generation
  --smoke        E1.2: force 5 iters × 50KB, --no-report; default OUT under os.tmpdir()
  --gates-e13    E1.3: defaults iters/size/out to plan values (repo docs/…/results/E1/e1-breakdown.jsonl),
                 wall-clock <= 300000 ms since process start-of-run, strict blockNumber non-decrease on ok rows
  --no-csv-header  E1.4: omit CSV header row (exactly N detail + 1 summary lines for N iters)
`);
}

const SMOKE_ITERS = 5;
const E13_ITERS = 100;
const E13_TARGET_BYTES = 50 * 1024;
const E13_WALL_MS = 5 * 60 * 1000;

function canonicalE13JsonlPath() {
  return path.normalize(path.resolve(defaultE1JsonlPath));
}

function enforceE13Preconditions(args) {
  const wantOut = canonicalE13JsonlPath();
  const gotOut = path.normalize(path.resolve(args.outJsonl));
  if (gotOut !== wantOut) {
    throw new Error(
      `--gates-e13 requires JSONL at ${wantOut}; got ${gotOut} (omit --out for default)`
    );
  }
  if (args.iters !== E13_ITERS || args.targetBytes !== E13_TARGET_BYTES) {
    throw new Error(`--gates-e13 requires exactly iters=${E13_ITERS} and size 50KB (${E13_TARGET_BYTES} bytes)`);
  }
}

/** @param {object[]} logicalRows chronological */
function assertBlockNumbersNonDecreasing(logicalRows) {
  let prev = null;
  let saw = false;
  for (const r of logicalRows) {
    if (!r.ok) {
      continue;
    }
    const bn = Number(r.blockNumber);
    if (!Number.isFinite(bn)) {
      throw new Error(`E1.3: iteration ${r.i}: ok row without finite blockNumber`);
    }
    saw = true;
    if (prev !== null && bn < prev) {
      throw new Error(
        `E1.3: blockNumber decreases at iteration ${r.i}: ${bn} after ${prev} (needs non-decreasing)`
      );
    }
    prev = bn;
  }
  if (!saw) {
    throw new Error('E1.3: no finite block numbers on ok rows');
  }
}

/**
 * Plan E1.2: five successful uploads + non-empty timings + stable requestId correlation.
 * @param {object[]} rows
 */
function assertSmokeRows(rows) {
  if (rows.length !== SMOKE_ITERS) {
    throw new Error(`E1 smoke: expected ${SMOKE_ITERS} JSONL rows, got ${rows.length}`);
  }
  for (const r of rows) {
    if (!r.ok || r.httpStatus !== 200) {
      throw new Error(`E1 smoke: iteration ${r.i}: expected ok & httpStatus 200`);
    }
    const rid = r.requestId;
    if (rid == null || String(rid).trim() === '') {
      throw new Error(`E1 smoke: iteration ${r.i}: requestId missing`);
    }
    const need = [
      'integrityMs',
      'localHashMs',
      'recordStoreMs',
      'chainMs',
      'caseRegistryMs',
      'totalMs',
      'residualMs'
    ];
    for (const k of need) {
      if (!Number.isFinite(Number(r[k]))) {
        throw new Error(`E1 smoke: iteration ${r.i}: ${k} must be finite (gateway timing breakdown)`);
      }
    }
  }
}

function parseSize(v) {
  if (typeof v !== 'string') {
    return null;
  }
  const m = /^(\d+)(kb|mb)$/i.exec(v.trim());
  if (!m) {
    const num = Number(v);
    return Number.isFinite(num) ? num | 0 : null;
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'kb') {
    return n * 1024;
  }
  if (unit === 'mb') {
    return n * 1024 * 1024;
  }
  return null;
}

function parseArgs(argv) {
  let iters = 100;
  let sizeHuman = '50KB';
  let targetBytes = 50 * 1024;
  let outJsonl = defaultE1JsonlPath;
  let noReport = false;
  let smoke = false;
  let gatesE13 = false;
  let outProvided = false;
  let noCsvHeader = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--iters') {
      iters = Math.max(1, Number(argv[++i]));
    } else if (a === '--size') {
      sizeHuman = argv[++i];
      const pb = parseSize(String(sizeHuman));
      if (pb == null || pb < 500) {
        throw new Error(`Invalid --size: ${sizeHuman}`);
      }
      targetBytes = pb;
    } else if (a === '--out') {
      outProvided = true;
      outJsonl = path.resolve(String(argv[++i]));
    } else if (a === '--no-report') {
      noReport = true;
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--gates-e13') {
      gatesE13 = true;
    } else if (a === '--no-csv-header') {
      noCsvHeader = true;
    }
  }
  return { help: false, iters, sizeHuman, targetBytes, outJsonl, noReport, smoke, gatesE13, outProvided, noCsvHeader };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    usage();
    process.exit(2);
    return;
  }
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }

  if (args.smoke && args.gatesE13) {
    console.error('--smoke cannot be combined with --gates-e13');
    usage();
    process.exit(2);
    return;
  }

  if (args.smoke) {
    args.iters = SMOKE_ITERS;
    args.targetBytes = 50 * 1024;
    args.sizeHuman = '50KB';
    args.noReport = true;
    if (!args.outProvided) {
      args.outJsonl = path.join(os.tmpdir(), 'e1-smoke.jsonl');
    }
  }

  if (args.gatesE13) {
    try {
      enforceE13Preconditions(args);
    } catch (err) {
      console.error(err.message || String(err));
      usage();
      process.exit(2);
      return;
    }
  }

  const wallClockT0 = Date.now();
  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(8).toString('hex');
  const rsFile = path.join(
    os.tmpdir(),
    `perf-e1-recordstore-${runId}-${process.pid}-${Date.now()}.json`
  );

  configurePerfEnv({ RECORD_STORE_PATH: rsFile });

  const jsonlOut = args.outJsonl || defaultE1JsonlPath;
  fs.mkdirSync(path.dirname(jsonlOut), { recursive: true });
  if (fs.existsSync(jsonlOut)) {
    fs.unlinkSync(jsonlOut);
  }

  fs.mkdirSync(defaultResultDir, { recursive: true });

  console.log(`E1 · iters=${args.iters} size=${args.sizeHuman} runId=${runId}`);

  const policeToken = await acquirePoliceToken();
  const isoStart = new Date().toISOString();

  let prevBlk = null;
  const logicalRows = [];

  for (let i = 0; i < args.iters; i++) {
    const caseId = `perf-e1-${runId}-${i}`;
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
      r.httpStatus === 200 && r.body && r.body.txHash && r.body.timing
    );
    const tim = ok ? r.body.timing : {};

    let integrityMs = ok ? Number(tim.integrityMs) : null;
    let localHashMs =
      ok && Number.isFinite(tim.localHashMs) ? Number(tim.localHashMs) : null;
    let recordStoreMs =
      ok && Number.isFinite(tim.recordStoreMs) ? Number(tim.recordStoreMs) : null;
    let chainMs = ok ? Number(tim.chainMs) : null;
    let caseRegistryMs =
      ok && tim.caseRegistryMs != null ? Number(tim.caseRegistryMs) : null;
    let totalMs = ok ? Number(tim.totalMs) : null;
    let residualMs = null;
    if (ok && Number.isFinite(totalMs) && Number.isFinite(integrityMs) && Number.isFinite(chainMs)) {
      residualMs = residualUploadMs({
        ok: true,
        totalMs,
        integrityMs,
        localHashMs,
        recordStoreMs,
        chainMs,
        caseRegistryMs
      });
    }
    let requestId = ok && r.body.requestId ? String(r.body.requestId) : '';

    let chainBlockNum =
      ok && r.body.blockNumber != null ? Number(r.body.blockNumber) : null;
    let regBlockNum =
      ok && r.body.caseRegistryBlockNumber != null
        ? Number(r.body.caseRegistryBlockNumber)
        : null;

    if (
      ok &&
      prevBlk !== null &&
      chainBlockNum != null &&
      chainBlockNum < prevBlk
    ) {

      ok = false;
    }
    if (ok && prevBlk !== null && chainBlockNum != null) {
      prevBlk = chainBlockNum;
    } else if (ok && chainBlockNum != null) {
      prevBlk = chainBlockNum;
    }

    const row = {
      experiment: 'E1',
      i,
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
      caseRegistryMs,
      totalMs,
      residualMs,
      clientRoundTripMs: r.clientRoundTripMs,
      requestId,
      txHash: r.body && r.body.txHash ? r.body.txHash : null,
      blockNumber: chainBlockNum,
      caseRegistryBlockNumber: regBlockNum,
      bodyError: ok ? null : r.body ? JSON.stringify(r.body) : 'no-json'
    };
    writeJsonl(jsonlOut, row);
    logicalRows.push(row);
  }

  const okRows = logicalRows.filter((z) => z.ok);
  const okCount = okRows.length;
  console.log(`E1 done · ${okCount}/${args.iters} ok · jsonl=${jsonlOut}`);

  let e14VerifyFailed = false;

  if (!args.noReport && okCount > 0) {
    const csvPath = path.join(defaultResultDir, 'e1-breakdown.csv');
    const { lines, m } = buildE1CsvLines(logicalRows, {
      iters: args.iters,
      okCount,
      includeHeader: !args.noCsvHeader
    });
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');

    const chk = verifyTotalMsP50Tolerance(logicalRows, m);
    if (!chk.ok) {
      console.error(
        `[E1.4] totalMs_p50 check: direct_p50=${chk.direct} summary_totalMs_p50=${chk.summary} delta_ms=${chk.delta}`
      );
      e14VerifyFailed = true;
    }

    printE1StackedBarStdout(m);

    writeE1BreakdownMarkdownFile(path.join(defaultResultDir, 'e1-breakdown.md'), {
      m,
      logicalRows,
      isoStart,
      recordStorePath: rsFile,
      iters: args.iters,
      targetBytes: args.targetBytes,
      sizeHuman: args.sizeHuman
    });

    console.log(`E1 csv=${csvPath}`);
    console.log(`E1 md =${path.join(defaultResultDir, 'e1-breakdown.md')}`);
  }

  const wallElapsedMs = Date.now() - wallClockT0;
  let exitCode = okCount >= args.iters ? 0 : 3;
  if (args.smoke && exitCode === 0) {
    try {
      assertSmokeRows(logicalRows);
    } catch (e) {
      console.error(e.message || String(e));
      exitCode = 22;
    }
  }

  if (args.smoke && exitCode === 0) {
    console.log('[E1 smoke] 5/5 ok');
  }

  if (args.gatesE13) {
    if (exitCode !== 0) {
      console.error(
        `[E1.3] gates not satisfied: uploads ${okCount}/${args.iters} ok (${wallElapsedMs} ms elapsed)`
      );
    } else {
      let gateExit = exitCode;
      if (wallElapsedMs > E13_WALL_MS) {
        console.error(
          `[E1.3] wall-clock ${wallElapsedMs} ms exceeds budget ${E13_WALL_MS} ms`
        );
        gateExit = 31;
      }
      if (gateExit === 0) {
        try {
          assertBlockNumbersNonDecreasing(logicalRows);
        } catch (e) {
          console.error(e.message || String(e));
          gateExit = 32;
        }
      }
      if (gateExit === 0) {
        const jp = canonicalE13JsonlPath();
        if (!fs.existsSync(jp)) {
          console.error(`[E1.3] expected JSONL missing: ${jp}`);
          gateExit = 33;
        } else {
          console.log(`[E1.3 full] gates ok (${wallElapsedMs} ms wall, JSONL ${jp})`);
        }
      }
      exitCode = gateExit;
    }
  }

  if (e14VerifyFailed && exitCode === 0) {
    exitCode = 34;
  }

  try {
    if (rsFile.startsWith(os.tmpdir()) && fs.existsSync(rsFile)) {
      fs.unlinkSync(rsFile);
    }
  } catch (_) {}

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
