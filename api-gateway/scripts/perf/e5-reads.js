'use strict';

/**
 * E5: read-path latency — POST /api/query (judge) then GET /api/case-exists (fresh OTP each call).
 *
 * E5.1: With an isolated temp record store (same pattern as E1/E4), we seed unique
 * `perf-e5-seed-<runId>-*` cases before reads; E1 JSONL is used for ratio baselines only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  apiRoot,
  configurePerfEnv,
  acquirePoliceToken,
  acquireToken,
  judgeAgent,
  queryOnce,
  caseExistsOnce,
  uploadOnce
} = require('./lib/harness');

configurePerfEnv();

const payload = require('./lib/payload');

const { loadE5Jsonl, loadE1ClientRoundTrips, buildE5CsvBundle, writeE5ReadsMarkdown } = require('./lib/e5Aggregate');

const workspaceRoot = path.join(apiRoot, '..');
const defaultResultDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaultE5Jsonl = path.join(defaultResultDir, 'E5', 'e5-reads.jsonl');
const defaultE1Jsonl = path.join(defaultResultDir, 'E1', 'e1-breakdown.jsonl');

const MIN_CORPUS = 50;
const FULL_QUERY = 200;
const FULL_EXISTS = 200;
const SMOKE_QUERY = 5;
const SMOKE_EXISTS = 5;
/** Plan E5.5 targets <3 min; default gate allows cold chain + 200× fresh OTP (override with PERF_E5_WALL_MS). */
const GATE_E55_WALL_MS = Number(process.env.PERF_E5_WALL_MS) || 6 * 60 * 1000;
const DEFAULT_SEED_BYTES = 50 * 1024;

function usage() {
  console.log(`
E5 read paths (query vs case-exists)

Usage:
  node scripts/perf/e5-reads.js [options]

Options:
  --queryIters <n>    POST /api/query count (default ${FULL_QUERY}; smoke ${SMOKE_QUERY})
  --existsIters <n>  GET case-exists count (default ${FULL_EXISTS}; smoke ${SMOKE_EXISTS})
  --out <file>        JSONL (default canonical E5/e5-reads.jsonl)
  --e1-jsonl <path>    E1 reference for upload RT ratios (canonical E1 JSONL)
  --min-corpus <n>     Seed uploads count (default ${MIN_CORPUS}; smoke lowers)
  --size <sx>          Seed payload UTF-8 target (default 50KB; match E1)
  --smoke              ${SMOKE_QUERY}+${SMOKE_EXISTS} iters; temp JSONL; no CSV/Markdown
  --gates-e55          Canonical OUT + (${FULL_QUERY}/${FULL_EXISTS}) + wall ≤ env PERF_E5_WALL_MS or 6min + ratio gate
  --no-report           Skip CSV + Markdown emission
`);
}

function canonicalE55Path() {
  return path.normalize(path.resolve(defaultE5Jsonl));
}

function appendJsonlBatch(absPath, objects) {
  if (!objects.length) {
    return;
  }
  fs.appendFileSync(absPath, `${objects.map((o) => JSON.stringify(o)).join('\n')}\n`, 'utf8');
}




function corpusCaseIds(runId, minNeeded) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < minNeeded; i += 1) {
    out.push(`perf-e5-seed-${runId}-${i}`);
  }
  return out;
}

/**
 * @param {number} targetBytes
 */
async function seedCorpus(policeToken, corpus, isoStart, runId, targetBytes) {
  for (let j = 0; j < corpus.length; j += 1) {
    const caseId = corpus[j];
    const generatedAt = new Date().toISOString();
    const { caseJson, aggregateHash } = payload.genAt(targetBytes | 0, caseId);
    const upRes = await uploadOnce(policeToken, {
      caseId,
      examiner: 'officer1',
      aggregateHash,
      generatedAt,
      caseJson
    });

    let ok =
      Boolean(
        upRes.httpStatus === 200 &&
          upRes.body &&
          upRes.body.txHash &&
          upRes.body.timing &&
          !upRes.body.duplicateCase
      );

    const exOnce = await caseExistsOnce(policeToken, caseId);
    if (!exOnce.body || exOnce.body.exists !== true) {
      ok = false;
    }

    if (!ok) {
      throw new Error(`E5 seed failed caseId=${caseId} uploadHttp=${upRes.httpStatus} exists=${Boolean(
        exOnce.body && exOnce.body.exists
      )}`);
    }
  }

  if (process.env.PERF_DEBUG_E5 === '1') {
    console.log(`[E5] corpus seeded n=${corpus.length} bytes≈${targetBytes} (${isoStart} run=${runId})`);
  }
}

async function phaseQueryWrites(jsonlAbs, agent, corpus, isoStart, runId, queryIters) {
  /** @type {object[]} */
  const out = [];

  for (let z = 0; z < queryIters; z += 1) {
    const caseId = corpus[z % corpus.length];
    const ts = new Date().toISOString();
    const r = await queryOnce(agent, caseId);
    const ok =
      r.httpStatus === 200 &&
      Boolean(r.body && r.body.integrity && r.body.integrity.recordHashMatch === true);
    out.push({
      experiment: 'E5',
      op: 'query',
      phaseTag: 'A-query',
      i: z,
      isoStartRun: isoStart,
      ts,
      runId,
      caseId,
      httpStatus: r.httpStatus | 0,
      ok,
      clientRoundTripMs: r.clientRoundTripMs,
      recordHashMatch: r.recordHashMatch
    });
  }
  appendJsonlBatch(jsonlAbs, out);
  return out;
}

async function phaseExistsWrites(jsonlAbs, corpus, isoStart, runId, existsIters) {
  /** @type {object[]} */
  const out = [];

  for (let z = 0; z < existsIters; z += 1) {
    const caseId = corpus[z % corpus.length];
    const ts = new Date().toISOString();
    const { token } = await acquireToken({ role: 'police', refresh: true });
    const r = await caseExistsOnce(token, caseId);

    let ok =
      r.httpStatus === 200 &&
      Boolean(r.body && r.body.exists === true && typeof r.body.exists !== 'undefined');
    const row = {
      experiment: 'E5',
      op: 'case-exists',
      phaseTag: 'B-case-exists',
      i: z,
      isoStartRun: isoStart,
      ts,
      runId,
      caseId,
      httpStatus: r.httpStatus | 0,
      ok,
      exists: ok ? true : Boolean(r.body && r.body.exists),
      clientRoundTripMs: r.clientRoundTripMs
    };
    out.push(row);
  }
  appendJsonlBatch(jsonlAbs, out);
  return out;
}

function parseSizeBytes(s, fallbackBytes) {
  if (s == null || String(s).trim() === '') {
    return fallbackBytes;
  }
  const t = String(s).trim().toUpperCase();
  const mKB = /^([0-9]+)\s*KB$/i.exec(t);
  const mMB = /^([0-9]+)\s*MB$/i.exec(t);
  if (mKB) {
    return Number(mKB[1]) * 1024;
  }
  if (mMB) {
    return Number(mMB[1]) * 1024 * 1024;
  }
  const n = Number(t);
  if (Number.isFinite(n) && n > 400) {
    return Math.floor(n);
  }
  return fallbackBytes;
}

function parseArgs(argv) {
  let queryIters = FULL_QUERY;
  let existsIters = FULL_EXISTS;
  let outJsonl = defaultE5Jsonl;
  let outProvided = false;
  let e1Jsonl = defaultE1Jsonl;
  let minCorpus = MIN_CORPUS;
  let smoke = false;
  let gatesE55 = false;
  let noReport = false;
  let sizeHuman = '';

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--queryIters') {
      queryIters = Math.max(1, Number(argv[++i]));
    } else if (a === '--existsIters') {
      existsIters = Math.max(1, Number(argv[++i]));
    } else if (a === '--out') {
      outProvided = true;
      outJsonl = path.resolve(String(argv[++i]));
    } else if (a === '--e1-jsonl') {
      e1Jsonl = path.resolve(String(argv[++i]));
    } else if (a === '--min-corpus') {
      minCorpus = Math.max(1, Number(argv[++i]));
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--gates-e55') {
      gatesE55 = true;
    } else if (a === '--no-report') {
      noReport = true;
    } else if (a === '--size') {
      sizeHuman = String(argv[++i]);
    }
  }

  if (gatesE55 && smoke) {
    throw new Error('--gates-e55 cannot combine with --smoke');
  }

  const seedBytes = parseSizeBytes(sizeHuman, DEFAULT_SEED_BYTES);

  if (smoke) {
    queryIters = SMOKE_QUERY;
    existsIters = SMOKE_EXISTS;
    if (!outProvided) {
      outJsonl = path.join(os.tmpdir(), `e5-smoke-${Date.now()}.jsonl`);
    }
    noReport = true;
    minCorpus = 15;
  }

  if (gatesE55) {
    queryIters = FULL_QUERY;
    existsIters = FULL_EXISTS;
    minCorpus = MIN_CORPUS;
    if (!outProvided) {
      outJsonl = defaultE5Jsonl;
    }
    const wantOut = canonicalE55Path();
    const gotOut = path.normalize(path.resolve(outJsonl));
    if (wantOut !== gotOut) {
      throw new Error(`--gates-e55 requires canonical OUT ${wantOut}; omit --out`);
    }
  }

  return {
    help: false,
    queryIters,
    existsIters,
    outJsonl,
    outProvided,
    e1Jsonl,
    minCorpus,
    smoke,
    gatesE55,
    noReport,
    seedBytes
  };
}

/** Require chainMock only after MAIL_DRY_RUN is set via configurePerfEnv. */
function assertChainMockAbsent() {
  // eslint-disable-next-line global-require
  const cm = require('./lib/chainMock');
  if (cm.isInstalled()) {
    console.error('FAIL · chainMock installed; E5 must observe real chain');
    process.exit(1);
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

  assertChainMockAbsent();

  const wallClockT0 = Date.now();

  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(8).toString('hex');
  const isoStartCoord = new Date().toISOString();

  const rsFileAbs = path.join(
    os.tmpdir(),
    `perf-e5-rs-${runId}-${process.pid}-${Date.now()}.json`
  );
  configurePerfEnv({ RECORD_STORE_PATH: rsFileAbs });

  const jsonlAbs = args.outJsonl;
  fs.mkdirSync(path.dirname(jsonlAbs), { recursive: true });
  if (fs.existsSync(jsonlAbs)) {
    fs.unlinkSync(jsonlAbs);
  }

  if (!fs.existsSync(args.e1Jsonl)) {
    console.error(`E5 needs E1 JSONL for ratios: missing ${args.e1Jsonl}`);
    process.exit(3);
    return;
  }

  const policeToken = await acquirePoliceToken();

  const corpus = corpusCaseIds(runId, args.minCorpus);
  await seedCorpus(policeToken, corpus, isoStartCoord, runId, args.seedBytes);

  const judge = await judgeAgent();

  console.log(
    `E5 · runId=${runId} queryIters=${args.queryIters} existsIters=${args.existsIters} corpus=${corpus.length} smoke=${Boolean(
      args.smoke
    )}`
  );

  const qRows = await phaseQueryWrites(jsonlAbs, judge, corpus, isoStartCoord, runId, args.queryIters);
  const xRows = await phaseExistsWrites(jsonlAbs, corpus, isoStartCoord, runId, args.existsIters);

  /** @type {object[]} */
  const allDrain = [...qRows, ...xRows];
  let exitCode = 0;

  const qOk = allDrain.filter((r) => r.op === 'query' && r.ok).length;
  const xOk = allDrain.filter((r) => r.op === 'case-exists' && r.ok).length;
  if (qOk < args.queryIters || xOk < args.existsIters) {
    console.error(`E5 success count query=${qOk}/${args.queryIters} case-exists=${xOk}/${args.existsIters}`);
    exitCode = Math.max(exitCode, 52);
  }

  const wallMs = Date.now() - wallClockT0;
  if (args.gatesE55 && wallMs > GATE_E55_WALL_MS) {
    console.error(`[E5.5] wall ${wallMs} ms exceeded gate ${GATE_E55_WALL_MS} ms`);
    exitCode = Math.max(exitCode, 54);
  }

  const e1Rt = loadE1ClientRoundTrips(args.e1Jsonl);
  if (!e1Rt.length) {
    console.error('E5: no E1 clientRoundTrip samples for baseline');
    exitCode = Math.max(exitCode, 55);
  }

  const nf4 = (x) => (Number.isFinite(Number(x)) ? Number(x).toFixed(4) : 'nan');

  const fullRows = loadE5Jsonl(jsonlAbs);
  let bundle;

  try {
    bundle = buildE5CsvBundle(fullRows, e1Rt);
    console.log(
      `[E5.6] ratio_query_p50=${nf4(bundle.summaryRows[0].ratio)} ratio_exists_p50=${nf4(bundle.summaryRows[1].ratio)} uploadRef_p50=${nf4(bundle.uploadP50)} gates query=${bundle.ratioPassQuery} exists=${bundle.ratioPassExists}`
    );
  } catch (e) {
    console.error(e.message || String(e));
    exitCode = Math.max(exitCode, 56);
    bundle = null;
  }

  const reportOkReads = qOk === args.queryIters && xOk === args.existsIters;

  if (!args.noReport && bundle && reportOkReads) {
    const csvPath = path.join(defaultResultDir, 'e5-reads.csv');
    fs.writeFileSync(csvPath, `${bundle.lines.join('\n')}\n`, 'utf8');
    console.log(`E5 csv=${csvPath}`);
    writeE5ReadsMarkdown(path.join(defaultResultDir, 'e5-reads.md'), {
      jsonlBasename: path.basename(jsonlAbs),
      corpusSize: corpus.length,
      runId,
      ratioPassQuery: bundle.ratioPassQuery,
      ratioPassExists: bundle.ratioPassExists,
      vizBlock: bundle.vizBlock,
      summaryRows: bundle.summaryRows,
      e1CsvBasename: 'E1/e1-breakdown.jsonl'
    });
    console.log(`E5 md=${path.join(defaultResultDir, 'e5-reads.md')}`);
  }

  if (args.gatesE55 && bundle && !(bundle.ratioPassQuery && bundle.ratioPassExists)) {
    console.error('[E5.6] ratio_to_upload_p50 gate failed (expected < 0.3 for query and case-exists)');
    exitCode = Math.max(exitCode, 53);
  }

  if (args.smoke && exitCode === 0) {
    console.log(`[E5 smoke] query=${args.queryIters}/${args.queryIters} case-exists=${args.existsIters}/${args.existsIters} ok wallMs=${wallMs}`);
  }

  try {
    if (rsFileAbs.startsWith(os.tmpdir()) && fs.existsSync(rsFileAbs)) {
      fs.unlinkSync(rsFileAbs);
    }
  } catch (_) {}

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
