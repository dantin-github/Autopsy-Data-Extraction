'use strict';

/**
 * E3: concurrency / throughput sweep for POST /api/upload (Contract + real chain).
 *
 * Usage (api-gateway root):
 *   npm run perf:e3 -- [options]
 *   node scripts/perf/e3-concurrency.js --levels 1,2,4,8,16 --duration 60s --size 100KB
 *
 * Acceptance (plan):
 *   --dry skips uploads; still refuses run if chainMock is installed.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { residualUploadMs } = require('./lib/e2Aggregate');
const { runForDuration } = require('./lib/stats');
const payload = require('./lib/payload');
const {
  apiRoot,
  configurePerfEnv,
  acquirePoliceToken,
  uploadOnce
} = require('./lib/harness');
const {
  csvHeaderLine,
  buildE3CsvArtifacts,
  writeE3MarkdownFile,
  DEFAULT_LEVEL_ORDER
} = require('./lib/e3Aggregate');

const workspaceRoot = path.join(apiRoot, '..');
const defaultResultDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaultE3JsonlDir = path.join(defaultResultDir, 'E3');
const defaultE3JsonlPath = path.join(defaultE3JsonlDir, 'e3-concurrency.jsonl');
/** E3 pairing driver (`e3-pair-crud-contract.js`) uses these for `--gates-e33` alongside the canonical JSONL. */
const e3PairCrudJsonlPath = path.join(defaultE3JsonlDir, 'e3-concurrency-crud.jsonl');
const e3PairContractJsonlPath = path.join(defaultE3JsonlDir, 'e3-concurrency-contract.jsonl');
const e3bJsonlDir = path.join(defaultResultDir, 'E3b');
const e3bCrudUploadJsonlPath = path.join(e3bJsonlDir, 'e3b-crud-upload.jsonl');
const e3bCaseRegistryUploadJsonlPath = path.join(e3bJsonlDir, 'e3b-case-registry-upload.jsonl');

const DEFAULT_DURATION_MS = 60_000;
const GATES_PAUSE_MS = 5000;
const E33_DURATION_MS = 60_000;
const E33_MIN_ROWS = 30;
const E33_WALL_BUDGET_MS = 6 * 60_000;

const SMOKY_LEVEL = 2;
const SMOKY_DURATION_MS = 10_000;
const SMOKY_MIN_ROWS = 5;
/** Avoid busy-loop in `--dry`; each synthetic completion yields briefly. */
const DRY_SPIN_MS = 5;

function usage() {
  console.log(`
E3 concurrency throughput

Usage:
  node scripts/perf/e3-concurrency.js [options]

Options:
  --levels <list>   Comma-separated concurrency levels (default 1,2,4,8,16)
  --duration <t>    Per-level wall window e.g. 60s or 60000 ms (default 60s)
  --size <sx>       caseJson UTF-8 target e.g. 100KB (default 100KB)
  --out <file>      JSONL (default docs/evidence/perf/results/E3/e3-concurrency.jsonl)
  --pause-ms <n>    Sleep between tiers in ms (${GATES_PAUSE_MS} when --gates-e33)
  --dry             Synthetic workers only (uploads suppressed)
  --smoke           E3.2: level=2 × ${SMOKY_DURATION_MS / 1000}s, JSONL default temp, --no-report
  --gates-e33       Canonical full sweep (${DEFAULT_LEVEL_ORDER.join(
    ','
  )}); ${E33_DURATION_MS / 1000}s/tier; ${E33_MIN_ROWS}+ rows/tier; wall ≤ ${E33_WALL_BUDGET_MS / 60000} min
  --no-report       Skip CSV + Markdown offline targets
  --verify          Exit 38 after run when post-aggregate verify fails (e.g. errorRate>0.5%)

Environment:
  PERF_RUN_ID     Stable run identifier prefix for perf-e3-<runId>-… caseIds
`);
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

/** @param {string} s */
function parseDurationMs(s) {
  const raw = String(s || '').trim();
  if (/^\d+ms$/i.test(raw)) {
    return Number(raw.slice(0, -2)) | 0;
  }
  if (/^\d+s$/i.test(raw)) {
    return (Number(raw.slice(0, -1)) | 0) * 1000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n | 0 : NaN;
}

/** @param {string} s */
function parseLevels(s) {
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const k = Number(x);
      if (!Number.isFinite(k) || k < 1) {
        throw new Error(`Invalid concurrency level: ${JSON.stringify(x)}`);
      }
      return k | 0;
    });
}

function canonicalE33JsonlPath() {
  return path.normalize(path.resolve(defaultE3JsonlPath));
}

/** `--gates-e33` JSONL targets: canonical default or explicit pair outputs (CRUD-only vs contract path). */
function gatesE33JsonlPathAccepted(gotNormalized) {
  const canon = canonicalE33JsonlPath();
  if (gotNormalized === canon) {
    return true;
  }
  const crud = path.normalize(path.resolve(e3PairCrudJsonlPath));
  const ctr = path.normalize(path.resolve(e3PairContractJsonlPath));
  const e3bCrud = path.normalize(path.resolve(e3bCrudUploadJsonlPath));
  const e3bReg = path.normalize(path.resolve(e3bCaseRegistryUploadJsonlPath));
  return gotNormalized === crud || gotNormalized === ctr || gotNormalized === e3bCrud || gotNormalized === e3bReg;
}

/** @returns {Promise<void>} */
function sleep(ms) {
  const n = Number(ms);
  const m = Number.isFinite(n) && n > 0 ? n | 0 : 0;
  if (m === 0) {
    return Promise.resolve();
  }
  return new Promise((r) => setTimeout(r, m));
}

/**
 * Require chainMock only after perf env overrides are set.
 */
function ensureChainMockNotInstalled() {
  const cm = require(path.join(__dirname, 'lib', 'chainMock'));
  if (cm.isInstalled && cm.isInstalled()) {
    console.error('FAIL · chainMock loaded; E3 must use real chain');
    process.exit(1);
  }
}

function parseArgs(argv) {
  let levelsStr = DEFAULT_LEVEL_ORDER.join(',');
  let durationMs = DEFAULT_DURATION_MS;
  let sizeHuman = '100KB';
  let targetBytes = 100 * 1024;
  let outJsonl = defaultE3JsonlPath;
  let outProvided = false;
  let pauseMsExplicit = NaN;
  let dry = false;
  let smoke = false;
  let gatesE33 = false;
  let noReport = false;
  let verifyAfter = false;

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--levels') {
      levelsStr = String(argv[++i]);
    } else if (a === '--duration') {
      durationMs = parseDurationMs(argv[++i]);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error('Invalid --duration (use e.g. 60s or 60000)');
      }
    } else if (a === '--size') {
      sizeHuman = String(argv[++i]);
      const pb = parseSize(String(sizeHuman));
      if (!pb || pb < 500) {
        throw new Error(`Invalid --size ${sizeHuman}`);
      }
      targetBytes = pb | 0;
    } else if (a === '--out') {
      outProvided = true;
      outJsonl = path.resolve(String(argv[++i]));
    } else if (a === '--pause-ms') {
      pauseMsExplicit = Number(argv[++i]);
      if (!Number.isFinite(pauseMsExplicit) || pauseMsExplicit < 0) {
        throw new Error('--pause-ms expects non-negative ms');
      }
    } else if (a === '--dry') {
      dry = true;
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--gates-e33') {
      gatesE33 = true;
    } else if (a === '--no-report') {
      noReport = true;
    } else if (a === '--verify') {
      verifyAfter = true;
    } else if (a === '') {
      /* ignore */
    } else {
      throw new Error(`Unknown arg ${a}`);
    }
  }

  if (smoke && gatesE33) {
    throw new Error('--smoke cannot be combined with --gates-e33');
  }

  let levels = parseLevels(levelsStr);

  if (smoke) {
    durationMs = SMOKY_DURATION_MS;
    levels = [SMOKY_LEVEL];
    noReport = true;
    if (!outProvided) {
      outJsonl = path.join(os.tmpdir(), 'e3-smoke.jsonl');
    }
  }

  if (gatesE33) {
    if (dry) {
      throw new Error('--gates-e33 cannot combine with --dry');
    }
    durationMs = E33_DURATION_MS;
    levels = DEFAULT_LEVEL_ORDER.slice();
    levelsStr = levels.join(',');
    if (!outProvided) {
      outJsonl = defaultE3JsonlPath;
    }
  }

  const pauseBetweenTiersMs = Number.isFinite(pauseMsExplicit)
    ? pauseMsExplicit
    : gatesE33
      ? GATES_PAUSE_MS
      : 0;

  if (gatesE33) {
    const wantStr = DEFAULT_LEVEL_ORDER.join(',');
    if (wantStr !== levels.join(',')) {
      throw new Error(`--gates-e33 requires levels ${wantStr}`);
    }
    if (durationMs !== E33_DURATION_MS) {
      throw new Error(`--gates-e33 requires duration 60s`);
    }
    const gotOut = path.normalize(path.resolve(outJsonl));
    if (!gatesE33JsonlPathAccepted(gotOut)) {
      throw new Error(
        `--gates-e33 requires --out ${canonicalE33JsonlPath()} (default), ` +
          `${path.normalize(path.resolve(e3PairCrudJsonlPath))}, ` +
          `${path.normalize(path.resolve(e3PairContractJsonlPath))}, ` +
          `${path.normalize(path.resolve(e3bCrudUploadJsonlPath))}, or ` +
          `${path.normalize(path.resolve(e3bCaseRegistryUploadJsonlPath))} (see scripts/perf/e3-pair-crud-contract.js, e3b-single-arms.js)`
      );
    }
    verifyAfter = true;
  }

  return {
    help: false,
    levels,
    durationMs,
    sizeHuman,
    targetBytes,
    outJsonl,
    dry,
    smoke,
    gatesE33,
    pauseBetweenTiersMs,
    noReport,
    verifyAfter
  };
}

function assertSmokeE3(rows) {
  const nonDry = rows.filter((r) => !r.dry);
  const forTier = nonDry.filter((r) => Number(r.level) === SMOKY_LEVEL);
  if (forTier.length < SMOKY_MIN_ROWS) {
    throw new Error(`E3 smoke: expected at least ${SMOKY_MIN_ROWS} non-dry rows at level=${SMOKY_LEVEL}, got ${forTier.length}`);
  }
  for (const r of forTier) {
    if (!r.ok || r.httpStatus !== 200) {
      throw new Error(`E3 smoke: failing row seq=${r.seq} http=${r.httpStatus}`);
    }
  }
}

async function main() {
  /** @type {ReturnType<parseArgs>} */
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

  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(8).toString('hex');
  const rsFile = path.join(
    os.tmpdir(),
    `perf-e3-rs-${runId}-${process.pid}-${Date.now()}.json`
  );

  configurePerfEnv({ RECORD_STORE_PATH: rsFile });
  ensureChainMockNotInstalled();

  const jsonlOut = args.outJsonl || defaultE3JsonlPath;
  fs.mkdirSync(path.dirname(jsonlOut), { recursive: true });
  if (fs.existsSync(jsonlOut)) {
    fs.unlinkSync(jsonlOut);
  }

  let policeToken = '';
  if (!args.dry) {
    policeToken = await acquirePoliceToken();
  }

  const wallClockT0 = Date.now();
  const isoCoordStart = new Date(wallClockT0).toISOString();

  /** @type {object[]} */
  const allWritten = [];

  console.log(
    `E3 · levels=[${args.levels.join(',')}] durMs=${args.durationMs} size=${args.sizeHuman} dry=${Boolean(
      args.dry
    )} jsonl=${jsonlOut}`
  );

  let gateExit = 0;

  for (let tierIdx = 0; tierIdx < args.levels.length; tierIdx += 1) {
    if (tierIdx > 0) {
      await sleep(args.pauseBetweenTiersMs);
    }
    const level = args.levels[tierIdx];
    let tierSeq = 0;

    async function workerFn() {
      const seq = (tierSeq += 1);

      if (args.dry) {
        await sleep(DRY_SPIN_MS);
        const row = {
          experiment: 'E3',
          dry: true,
          level,
          runId,
          seq,
          ts: new Date().toISOString(),
          caseId: `perf-e3-dry-${runId}-${level}-${seq}`,
          httpStatus: 200,
          ok: true,
          integrityMs: 0,
          localHashMs: 0,
          recordStoreMs: 0,
          chainMs: 0,
          caseRegistryMs: 0,
          totalMs: 0,
          residualMs: 0,
          clientRoundTripMs: 0,
          requestId: ''
        };
        return row;
      }

      const caseId = `perf-e3-${runId}-L${level}-s${seq}-${crypto.randomBytes(5).toString('hex')}`;
      const generatedAt = new Date().toISOString();
      let ok = false;
      let integrityMs = null;
      let localHashMs = null;
      let recordStoreMs = null;
      let chainMs = null;
      let caseRegistryMs = null;
      let totalMs = null;
      let residualMs = null;
      let requestId = '';
      let txHash = null;
      let blockNumber = null;
      let bodyError = null;
      /** @type {number} */
      let httpStatus = 0;

      try {
        const { caseJson, aggregateHash } = payload.genAt(args.targetBytes | 0, caseId);

        const r = await uploadOnce(policeToken, {
          caseId,
          examiner: 'officer1',
          aggregateHash,
          generatedAt,
          caseJson
        });

        httpStatus = r.httpStatus | 0;
        ok =
          Boolean(r.httpStatus === 200 && r.body && r.body.txHash && r.body.timing) &&
          !(r.body && r.body.duplicateCase);

        const tim = ok ? r.body.timing : {};
        integrityMs = ok ? Number(tim.integrityMs) : null;
        localHashMs =
          ok && Number.isFinite(tim.localHashMs) ? Number(tim.localHashMs) : null;
        recordStoreMs =
          ok && Number.isFinite(tim.recordStoreMs) ? Number(tim.recordStoreMs) : null;
        chainMs = ok ? Number(tim.chainMs) : null;
        caseRegistryMs =
          ok && tim.caseRegistryMs != null ? Number(tim.caseRegistryMs) : null;
        totalMs = ok ? Number(tim.totalMs) : null;

        residualMs =
          ok && Number.isFinite(totalMs) ? residualUploadMs({ ok: true, ...tim }) : null;

        requestId = ok && r.body.requestId ? String(r.body.requestId) : '';
        txHash = r.body && r.body.txHash ? r.body.txHash : null;
        blockNumber = r.body && r.body.blockNumber != null ? Number(r.body.blockNumber) : null;
        bodyError = ok ? null : JSON.stringify(r.body || 'no-json');

        return {
          experiment: 'E3',
          dry: false,
          level,
          runId,
          seq,
          ts: generatedAt,
          caseId,
          httpStatus,
          ok,
          integrityMs,
          localHashMs,
          recordStoreMs,
          chainMs,
          caseRegistryMs,
          totalMs,
          residualMs,
          clientRoundTripMs: r.clientRoundTripMs,
          requestId,
          txHash,
          blockNumber,
          utf8Approx: Buffer.byteLength(caseJson, 'utf8'),
          bodyError
        };
      } catch (e) {
        return {
          experiment: 'E3',
          dry: false,
          level,
          runId,
          seq,
          ts: new Date().toISOString(),
          caseId,
          httpStatus,
          ok: false,
          error: String(e && e.message ? e.message : e)
        };
      }
    }

    const tierWallStartIso = new Date(Date.now()).toISOString();

    let results;
    let wallMsTotal;
    try {
      const out = await runForDuration(workerFn, level, args.durationMs);
      results = out.results;
      wallMsTotal = out.wallMs;
    } catch (e) {
      console.error(e);
      gateExit = 35;
      break;
    }

    const tierWallEndIso = new Date(Date.now()).toISOString();

    const linesAgg = `${results
      .map((rr) => {
        Object.assign(rr, {
          tierWallMs: wallMsTotal,
          startTs: tierWallStartIso,
          endTs: tierWallEndIso
        });
        allWritten.push(rr);
        return JSON.stringify(rr);
      })
      .join('\n')}\n`;

    fs.appendFileSync(jsonlOut, linesAgg, 'utf8');

    const okCt = results.filter((r) => !r.error && r.ok).length;

    console.log(
      `[E3] level=${level} wallMs=${wallMsTotal} completions=${results.length} ok=${okCt} (written JSONL)`
    );
  }

  const wallElapsed = Date.now() - wallClockT0;

  if (args.smoke && gateExit === 0) {
    try {
      assertSmokeE3(allWritten);
    } catch (e) {
      console.error(e.message || String(e));
      gateExit = 36;
    }
    if (gateExit === 0) {
      console.log(`[E3 smoke] level=${SMOKY_LEVEL} N=${allWritten.filter((r) => !r.dry).length} ok`);
    }
  }

  if (args.gatesE33 && gateExit === 0) {
    if (wallElapsed > E33_WALL_BUDGET_MS) {
      console.error(
        `[E3.3] wall ${wallElapsed} ms exceeds budget ${E33_WALL_BUDGET_MS} ms (+ pauses)`
      );
      gateExit = 41;
    } else if (gateExit === 0) {
      const artMini = buildE3CsvArtifacts(allWritten, {
        levelOrder: args.levels,
        minRowsPerTier: E33_MIN_ROWS,
        maxErrorRate: 0.005
      });
      if (!artMini.verifyOk) {
        console.error(`[E3.3] rows gate:\n${artMini.verifyMsgs.join('\n')}`);
        gateExit = 42;
      } else {
        console.log(
          `[E3.3 full] gates ok (wall=${wallElapsed} ms, JSONL=${path.normalize(jsonlOut)})`
        );
      }
    }
  }

  let verifyFailed = false;
  if (!args.noReport && allWritten.some((z) => !z.dry) && gateExit === 0) {
    const csvPath = path.join(defaultResultDir, 'e3-concurrency.csv');
    const mdPath = path.join(defaultResultDir, 'e3-concurrency.md');

    const art = buildE3CsvArtifacts(allWritten, {
      levelOrder: args.levels,
      minRowsPerTier: args.gatesE33 ? E33_MIN_ROWS : undefined,
      maxErrorRate: 0.005
    });

    const linesAgg = [csvHeaderLine(), ...art.lines, art.summaryLine];

    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, `${linesAgg.join('\n')}\n`, 'utf8');

    const degraded = art.summaries.filter((z) => z.status === 'degraded');
    const degradedNote =
      degraded.length > 0
        ? `Degraded tiers (errorRate>0.5% gate): levels ${degraded.map((z) => z.level).join(', ')}`
        : '';

    const summariesAsc = art.summaries.slice().sort((a, b) => a.level - b.level);

    writeE3MarkdownFile(mdPath, {
      summariesAsc,
      knee: art.knee,
      isoStart: isoCoordStart,
      durationMs: args.durationMs,
      targetBytes: args.targetBytes,
      sizeHuman: args.sizeHuman,
      jsonlBasename: path.basename(jsonlOut),
      fileRows: allWritten.length,
      parsedRows: allWritten.length,
      okUploadRows: allWritten.filter((z) => !z.dry && z.ok === true && z.httpStatus === 200).length,
      degradedNote
    });

    console.log(formatStdoutTable(summariesAsc));

    console.log(`E3 csv=${csvPath}`);
    console.log(`E3 md =${mdPath}`);

    if (args.verifyAfter && !art.verifyOk) {
      console.error(`[E3.4 verify] FAIL:\n${art.verifyMsgs.join('\n')}`);
      verifyFailed = true;
    }
  }

  if (verifyFailed) {
    gateExit = 38;
  }

  try {
    if (rsFile.startsWith(os.tmpdir()) && fs.existsSync(rsFile)) {
      fs.unlinkSync(rsFile);
    }
  } catch (_) {}

  const exitCode = gateExit !== 0 ? gateExit : verifyFailed ? 38 : 0;
  process.exit(exitCode);
}

function formatStdoutTable(summariesAsc) {
  const hdr =
    '| level | tps | errRate | tot_p50 | tot_p99 | crt_p99 | wallMs |\n| --- | --- | --- | --- | --- | --- | --- |\n';
  const body = summariesAsc.map(
    (s) =>
      `| ${s.level} | ${s.tps.toFixed(3)} | ${s.errorRate.toFixed(4)} | ${fin(
        s.totalMs.p50
      )} | ${fin(s.totalMs.p99)} | ${fin(s.client.p99)} | ${fin(s.tierWallMs)} |`
  );
  return `${hdr}${body.join('\n')}`;
}

function fin(v) {
  return Number.isFinite(v) ? v.toFixed(1) : 'na';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
