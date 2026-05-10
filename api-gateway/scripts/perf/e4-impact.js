'use strict';

/**
 * E4: blockchain impact — real chain timings (phase A) vs chainMock stubs (phase B).
 *
 * Defaults: 50 KB payload (match E1), 100 uploads per variant, JSONL → CSV + Markdown.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { residualUploadMs } = require('./lib/e2Aggregate');
const {
  apiRoot,
  configurePerfEnv,
  acquirePoliceToken,
  uploadOnce
} = require('./lib/harness');
const payload = require('./lib/payload');
const mock = require('./lib/chainMock');

const {
  loadE4Jsonl,
  buildE4CsvLines,
  writeE4ImpactMarkdown
} = require('./lib/e4Aggregate');

const workspaceRoot = path.join(apiRoot, '..');
const defaultResultDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaultE4JsonlDir = path.join(defaultResultDir, 'E4');
const defaultE4JsonlPath = path.join(defaultE4JsonlDir, 'e4-impact.jsonl');

const DEFAULT_E1_JSONL = path.join(defaultResultDir, 'E1', 'e1-breakdown.jsonl');

/** Plan target: mock chainRegs ≤ 2 ms; tolerate Date.now() granularity on hosts. */
const MOCK_SUM_WARN_MS = 2;
const MOCK_SUM_GATE_MS = 25;

function usage() {
  console.log(`
E4 blockchain impact (real vs mock)

Usage:
  node scripts/perf/e4-impact.js [options]

Options:
  --iters <n>      Uploads per phase (default 100; smoke: 5)
  --reuse-e1       Skip Phase A uploads; splice successful rows from --e1-jsonl
  --e1-jsonl <p>   Source for reuse (default: docs/.../E1/e1-breakdown.jsonl)
  --out <file>     JSONL output (${defaultE4JsonlPath})
  --smoke          5-and-5, temp JSONL, relaxed mock timing gate
  --gates-e44      Canonical out path + iters==100 + no smoke
  --no-report      Skip CSV + Markdown
`);
}

function canonicalE44Path() {
  return path.normalize(path.resolve(defaultE4JsonlPath));
}

function appendJsonlBatch(absPath, objects) {
  if (objects.length === 0) {
    return;
  }
  fs.appendFileSync(
    absPath,
    `${objects.map((o) => JSON.stringify(o)).join('\n')}\n`,
    'utf8'
  );
}

/**
 * @param {string} e1Abs
 * @param {number} need
 */
function loadReuseRowsFromE1(e1Abs, need) {
  const raw = fs.readFileSync(e1Abs, 'utf8');
  /** @type {object[]} */
  const picked = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || picked.length >= need) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(t);
    } catch {
      continue;
    }
    const exp =
      row.experiment == null || String(row.experiment).trim() === ''
        ? 'E1'
        : String(row.experiment).trim();
    if (exp !== 'E1' && exp !== 'e1') {
      continue;
    }
    const okRow =
      Boolean(row.ok) &&
      Number(row.httpStatus) === 200 &&
      Number.isFinite(Number(row.totalMs));
    if (!okRow) {
      continue;
    }
    picked.push(row);
  }
  if (picked.length < need) {
    throw new Error(`E4 reuse-e1: need ${need} ok E1-like rows from ${e1Abs}, got ${picked.length}`);
  }
  /** @returns {object} */
  function mapReal(r, idxHint) {
    return {
      experiment: 'E4',
      variant: 'real',
      reusedFromE1: true,
      i: typeof r.i === 'number' ? r.i : idxHint,
      runId: r.runId || 'e1',
      caseId: r.caseId || `reuse-${idxHint}`,
      ts: typeof r.ts === 'string' ? r.ts : new Date().toISOString(),
      httpStatus: 200,
      ok: true,
      utf8Approx: r.utf8Approx,
      integrityMs: Number.isFinite(Number(r.integrityMs)) ? Number(r.integrityMs) : null,
      localHashMs: Number.isFinite(Number(r.localHashMs)) ? Number(r.localHashMs) : null,
      recordStoreMs: Number.isFinite(Number(r.recordStoreMs)) ? Number(r.recordStoreMs) : null,
      chainMs: Number(r.chainMs),
      caseRegistryMs: Number.isFinite(Number(r.caseRegistryMs)) ? Number(r.caseRegistryMs) : null,
      residualMs:
        r.residualMs != null && Number.isFinite(Number(r.residualMs))
          ? Number(r.residualMs)
          : null,
      totalMs: Number(r.totalMs),
      clientRoundTripMs: Number(r.clientRoundTripMs),
      blockNumber: r.blockNumber ?? null,
      requestId: typeof r.requestId === 'string' ? r.requestId : '',
      txHash: r.txHash || null,
      phaseTag: 'A-reused-from-e1'
    };
  }
  return picked.slice(0, need).map((r, j) => mapReal(r, j));
}

async function phaseRealUpload(jsonlAbs, policeToken, runId, isoStart, iters, targetBytes) {
  /** @type {object[]} */
  const out = [];

  let prevBlk = null;

  for (let z = 0; z < iters; z += 1) {
    const i = z;
    const caseId = `perf-e4-real-${runId}-${z}`;
    const generatedAt = new Date().toISOString();

    const { caseJson, aggregateHash, utf8Len } = payload.genAt(targetBytes | 0, caseId);

    const r = await uploadOnce(policeToken, {
      caseId,
      examiner: 'officer1',
      aggregateHash,
      generatedAt,
      caseJson
    });

    let ok = Boolean(
      r.httpStatus === 200 && r.body && r.body.txHash && r.body.timing && !r.body.duplicateCase
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
    let residualMs =
      ok && Number.isFinite(totalMs) ? residualUploadMs({ ok: true, ...tim }) : null;
    let requestId = ok && r.body.requestId ? String(r.body.requestId) : '';
    const chainBlk = ok && r.body.blockNumber != null ? Number(r.body.blockNumber) : null;

    if (ok && prevBlk !== null && chainBlk != null && chainBlk < prevBlk) {
      ok = false;
    }
    if (ok && chainBlk != null) {
      prevBlk = chainBlk;
    }

    const row = {
      experiment: 'E4',
      variant: 'real',
      reusedFromE1: false,
      i,
      isoStartRun: isoStart,
      ts: generatedAt,
      runId,
      caseId,
      httpStatus: r.httpStatus | 0,
      ok,
      utf8Approx: utf8Len,
      integrityMs,
      localHashMs,
      recordStoreMs,
      chainMs,
      caseRegistryMs,
      residualMs,
      totalMs,
      clientRoundTripMs: r.clientRoundTripMs,
      blockNumber: chainBlk,
      requestId,
      phaseTag: 'A-live'
    };
    out.push(row);
  }

  appendJsonlBatch(jsonlAbs, out);
}

async function phaseMockUpload(jsonlAbs, policeToken, runId, isoStartB, iters, targetBytes, smoke) {
  /** @type {object[]} */
  const out = [];

  mock.install(null);
  try {
    for (let z = 0; z < iters; z += 1) {
      const caseId = `perf-e4-${runId}-mock-${z}`;
      const generatedAt = new Date().toISOString();
      const { caseJson, aggregateHash, utf8Len } = payload.genAt(targetBytes | 0, caseId);
      const r = await uploadOnce(policeToken, {
        caseId,
        examiner: 'officer1',
        aggregateHash,
        generatedAt,
        caseJson
      });

      let ok = Boolean(r.httpStatus === 200 && r.body && r.body.txHash && r.body.timing);
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
      let residualMs =
        ok && Number.isFinite(totalMs) ? residualUploadMs({ ok: true, ...tim }) : null;
      let requestId = ok && r.body.requestId ? String(r.body.requestId) : '';

      const crSum =
        Number.isFinite(chainMs) && Number.isFinite(caseRegistryMs)
          ? chainMs + caseRegistryMs
          : Infinity;
      if (ok && crSum > MOCK_SUM_WARN_MS) {
        console.warn(
          `[E4] mock tier row z=${z} chainMs+caseRegistryMs=${crSum.toFixed(
            2
          )} ms (>${MOCK_SUM_WARN_MS} ms note)`
        );
      }

      out.push({
        experiment: 'E4',
        variant: 'mock',
        i: z,
        isoStartRun: isoStartB,
        ts: generatedAt,
        runId,
        caseId,
        httpStatus: r.httpStatus | 0,
        ok,
        utf8Approx: utf8Len,
        integrityMs,
        localHashMs,
        recordStoreMs,
        chainMs,
        caseRegistryMs,
        residualMs,
        totalMs,
        clientRoundTripMs: r.clientRoundTripMs,
        requestId,
        phaseTag: 'B-mocked'
      });
    }
  } finally {
    mock.restore();
  }

  appendJsonlBatch(jsonlAbs, out);

  /** @returns {boolean} */
  let pass = true;
  const gateLimit = smoke ? 80 : MOCK_SUM_GATE_MS;
  for (const r of out) {
    const ch = Number(r.chainMs) || 0;
    const reg = Number.isFinite(Number(r.caseRegistryMs)) ? Number(r.caseRegistryMs) : 0;
    if (r.ok && ch + reg > gateLimit) {
      pass = false;
    }
  }
  return { pass, mocks: out };
}

function parseArgs(argv) {
  let iters = 100;
  let reuseE1 = false;
  let e1JsonlPath = DEFAULT_E1_JSONL;
  let smoke = false;
  let gatesE44 = false;
  let noReport = false;
  let outJsonlPath = defaultE4JsonlPath;
  let outProvided = false;
  let targetBytes = 50 * 1024;

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--iters') {
      iters = Math.max(1, Number(argv[++i]));
    } else if (a === '--reuse-e1') {
      reuseE1 = true;
    } else if (a === '--e1-jsonl') {
      e1JsonlPath = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      outProvided = true;
      outJsonlPath = path.resolve(String(argv[++i]));
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--gates-e44') {
      gatesE44 = true;
    } else if (a === '--no-report') {
      noReport = true;
    }
  }

  if (gatesE44 && smoke) {
    throw new Error('--gates-e44 cannot combine with --smoke');
  }

  if (smoke) {
    iters = 5;
    if (!outProvided) {
      outJsonlPath = path.join(os.tmpdir(), `e4-smoke-${Date.now()}.jsonl`);
    }
    noReport = true;
  }

  if (gatesE44) {
    iters = 100;
    reuseE1 = false;
    if (!outProvided) {
      outJsonlPath = defaultE4JsonlPath;
    }
    if (canonicalE44Path() !== path.normalize(path.resolve(outJsonlPath))) {
      throw new Error(`--gates-e44 expects canonical OUT ${canonicalE44Path()} (omit --out)`);
    }
  }

  return {
    help: false,
    iters,
    reuseE1,
    e1JsonlPath,
    smoke,
    gatesE44,
    noReport,
    outJsonlPath,
    targetBytes
  };
}

function meanTotalMs(rowsVariant) {
  const ok = rowsVariant.filter((r) => r.ok && Number(r.totalMs)).map((z) => Number(z.totalMs));
  if (!ok.length) {
    return NaN;
  }
  return ok.reduce((s, z) => s + z, 0) / ok.length;
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

  if (mock.isInstalled()) {
    console.error('FAIL · chainMock already installed — abort');
    process.exit(1);
    return;
  }

  const isoStartCoord = new Date().toISOString();
  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(8).toString('hex');
  const rsFileAbs = path.join(
    os.tmpdir(),
    `perf-e4-rs-${runId}-${process.pid}-${Date.now()}.json`
  );

  configurePerfEnv({ RECORD_STORE_PATH: rsFileAbs });

  fs.mkdirSync(path.dirname(args.outJsonlPath), { recursive: true });
  if (fs.existsSync(args.outJsonlPath)) {
    fs.unlinkSync(args.outJsonlPath);
  }

  const policeToken = await acquirePoliceToken();

  console.log(`E4 · runId=${runId} iters(per phase)=${args.iters} reuseE1=${args.reuseE1} smoke=${Boolean(
    args.smoke
  )}`);

  let realMeanForCompare = NaN;

  /** @type {object[]} */
  let allRowsDrain = [];

  if (args.reuseE1) {
    if (!fs.existsSync(args.e1JsonlPath)) {
      console.error(`E4 --reuse-e1 missing file ${args.e1JsonlPath}`);
      process.exit(3);
      return;
    }
    const reused = loadReuseRowsFromE1(args.e1JsonlPath, args.iters);
    appendJsonlBatch(args.outJsonlPath, reused);
    realMeanForCompare = meanTotalMs(reused);
    allRowsDrain.push(...reused);
  } else {
    await phaseRealUpload(
      args.outJsonlPath,
      policeToken,
      runId,
      isoStartCoord,
      args.iters,
      args.targetBytes
    );
    const realSlice = loadE4Jsonl(args.outJsonlPath).filter((z) => z.variant === 'real');
    realMeanForCompare = meanTotalMs(realSlice);
    allRowsDrain.push(...realSlice);
  }

  const isoB = new Date().toISOString();
  const { pass: mockGatePass, mocks } = await phaseMockUpload(
    args.outJsonlPath,
    policeToken,
    runId,
    isoB,
    args.iters,
    args.targetBytes,
    args.smoke
  );
  allRowsDrain.push(...mocks);

  let exitCode = 0;
  if (!mockGatePass) {
    console.error(
      `[E4.4] mock chain+caseRegistry gate failed (need ≤ ${args.smoke ? 80 : MOCK_SUM_GATE_MS} ms per ok row)`
    );
    exitCode = 44;
  }

  const realOk = allRowsDrain.filter((z) => z.variant === 'real' && z.ok).length;
  const mockOk = allRowsDrain.filter((z) => z.variant === 'mock' && z.ok).length;
  if (realOk < args.iters || mockOk < args.iters) {
    console.error(`E4.4 success count real=${realOk} mock=${mockOk} (need ${args.iters} each)`);
    exitCode = Math.max(exitCode, 45);
  }

  let e1ComparePct;
  if (!args.reuseE1 && fs.existsSync(DEFAULT_E1_JSONL)) {
    const e1Rows = loadReuseRowsFromE1(DEFAULT_E1_JSONL, Math.min(100, args.iters));
    const e1Mean = meanTotalMs(e1Rows);
    if (Number.isFinite(realMeanForCompare) && Number.isFinite(e1Mean) && e1Mean > 1e-6) {
      e1ComparePct = (Math.abs(realMeanForCompare - e1Mean) / e1Mean) * 100;
      if (e1ComparePct > 12) {
        console.warn(
          `[E4.4] real mean totalMs=${realMeanForCompare.toFixed(
            2
          )} vs E1 ref mean=${e1Mean.toFixed(2)} drift ${e1ComparePct.toFixed(1)}%`
        );
      }
    }
  }

  if (!args.noReport && exitCode === 0) {
    const full = loadE4Jsonl(args.outJsonlPath);
    const { lines, triple, deltaPctMedian } = buildE4CsvLines(full);
    const csvPath = path.join(defaultResultDir, 'e4-impact.csv');
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
    const mdPath = path.join(defaultResultDir, 'e4-impact.md');
    writeE4ImpactMarkdown(mdPath, {
      triple,
      isoStart: isoStartCoord,
      reuseE1: args.reuseE1,
      iters: args.iters,
      targetBytes: args.targetBytes,
      jsonlBasename: path.basename(args.outJsonlPath),
      realSourceNote: args.reuseE1
        ? `Real branch sourced from ${path.basename(args.e1JsonlPath)}`
        : `Real branch executed in-process with live chain`,
      e1ComparePct
    });
    console.log(`E4 csv=${csvPath}`);
    console.log(`E4 md =${mdPath}`);
    console.log(
      `[E4.5] Δ median pct≈${Number.isFinite(deltaPctMedian) ? deltaPctMedian.toFixed(4) + '%' : 'n/a'}`
    );
  }

  if (args.smoke && exitCode === 0) {
    console.log(`[E4 smoke] real+mock iterations=${args.iters} ×2 ok`);
  }

  if (args.gatesE44 && exitCode !== 0) {
    console.error('[E4.4] canonical gates incomplete');
    exitCode = Math.max(exitCode, 46);
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
