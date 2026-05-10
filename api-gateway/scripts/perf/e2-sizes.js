'use strict';

/**
 * E2: caseJson size scaling — sequential POST /api/upload per size tier (X-Debug-Timing).
 *
 * Usage:
 *   npm run perf:e2 -- [options]
 *   node scripts/perf/e2-sizes.js [--tiers <list|all>] [--iters <n>] [--out <jsonl>]
 *
 * Plan E2.2: CLI + JSONL rows include `sizeTier`. Defaults: all five tiers, iters=30,
 * out=docs/evidence/perf/results/E2/e2-sizes.jsonl (CSV/MD in E2.5–E2.6).
 * Plan E2.4–E2.6: default run produces results/E2/e2-sizes.jsonl + e2-sizes.csv + e2-sizes.md;
 * `npm run perf:e2:full` = `--gates-e24` (5×30, canonical JSONL, wall/150 gates).
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
  buildE2CsvLines,
  formatE2LineVisualization,
  writeE2SizesMarkdownFile,
  countJsonlNonEmptyLines,
  residualUploadMs
} = require('./lib/e2Aggregate');

const workspaceRoot = path.join(apiRoot, '..');
const defaultResultDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaultE2JsonlDir = path.join(defaultResultDir, 'E2');
const defaultE2JsonlPath = path.join(defaultE2JsonlDir, 'e2-sizes.jsonl');

function usage() {
  console.log(`
E2 case-size scaling

Usage:
  npm run perf:e2 -- [options]
  node scripts/perf/e2-sizes.js [options]

Options:
  --tiers <list>   Comma-separated tier keys: 10K, 100K, 1M, 5M, 10M (default: all five)
  --iters <n>      Uploads per tier (default 30; plan E2.4 = 30)
  --out <file>     JSONL path (default docs/evidence/perf/results/E2/e2-sizes.jsonl)
  --smoke          E2.3: force tier=10K, iters=3, JSONL under os.tmpdir() unless --out
  --no-report      Skip CSV + Markdown (E2.5–E2.6)
  --verify         After CSV: exit 37 if E2.5 gates fail (r ≥ 0.9; CV when stage mean ≥ 200/300 ms)
  --gates-e24      E2.4: require all five tiers, iters=30, canonical JSONL path; wall & 150-count gates
  --block-sync     Before each chainMs call, wait for the next block boundary (X-Block-Sync-Before-Chain: 1).
                   Eliminates bimodal chainMs at large file sizes caused by variable recordStoreMs landing
                   at random offsets in the block interval. Adds ~1× block-interval overhead per upload.
`);
}

const E23_SMOKE_TIER = '10K';
const E23_SMOKE_ITERS = 3;

/**
 * Plan E2.3: three successful uploads at 10K, non-empty gateway timings + sizeTier.
 * @param {object[]} rows
 */
function assertE2SmokeRows(rows) {
  if (rows.length !== E23_SMOKE_ITERS) {
    throw new Error(`E2 smoke: expected ${E23_SMOKE_ITERS} JSONL rows, got ${rows.length}`);
  }
  for (const r of rows) {
    if (r.sizeTier !== E23_SMOKE_TIER) {
      throw new Error(`E2 smoke: expected sizeTier ${E23_SMOKE_TIER}, got ${r.sizeTier}`);
    }
    if (!r.ok || r.httpStatus !== 200) {
      throw new Error(`E2 smoke: row i=${r.i}: expected ok & httpStatus 200`);
    }
    const rid = r.requestId;
    if (rid == null || String(rid).trim() === '') {
      throw new Error(`E2 smoke: row i=${r.i}: requestId missing`);
    }
    const need = [
      'integrityMs',
      'localHashMs',
      'recordStoreMs',
      'chainMs',
      'caseRegistryMs',
      'totalMs'
    ];
    for (const k of need) {
      if (!Number.isFinite(Number(r[k]))) {
        throw new Error(`E2 smoke: row i=${r.i}: ${k} must be finite (gateway timing breakdown)`);
      }
    }
  }
}

/**
 * @param {string} s
 * @returns {string[]}
 */
function parseTiersArg(s) {
  const t = String(s || '')
    .trim()
    .toLowerCase();
  if (t === '' || t === 'all') {
    return [...payload.E2_TIER_ORDER];
  }
  const parts = String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const key = normalizeTierKey(p);
    if (!payload.E2_TIER_BYTES[key]) {
      throw new Error(`Unknown tier "${p}" (expect 10K, 100K, 1M, 5M, 10M)`);
    }
    out.push(key);
  }
  return out;
}

/** @param {string} p */
function normalizeTierKey(p) {
  const u = String(p).trim();
  const m = /^(\d+)\s*([km])$/i.exec(u.replace(/\s/g, ''));
  if (m) {
    const n = m[1];
    const uu = m[2].toUpperCase();
    return `${n}${uu === 'K' ? 'K' : 'M'}`;
  }
  const aliases = {
    '10k': '10K',
    '100k': '100K',
    '1m': '1M',
    '5m': '5M',
    '10m': '10M'
  };
  const low = u.toLowerCase();
  if (aliases[low]) {
    return aliases[low];
  }
  const upper = u.length <= 4 ? u.toUpperCase() : u[0].toUpperCase() + u.slice(1).toUpperCase();
  if (payload.E2_TIER_BYTES[upper]) {
    return upper;
  }
  if (payload.E2_TIER_BYTES[u]) {
    return u;
  }
  return u;
}

function parseArgs(argv) {
  let tiersStr = 'all';
  let iters = 30;
  let outJsonl = defaultE2JsonlPath;
  let smoke = false;
  let outProvided = false;
  let noReport = false;
  let verify = false;
  let gatesE24 = false;
  let blockSync = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--tiers') {
      tiersStr = String(argv[++i]);
    } else if (a === '--iters') {
      iters = Math.max(1, Number(argv[++i]));
    } else if (a === '--out') {
      outProvided = true;
      outJsonl = path.resolve(String(argv[++i]));
    } else if (a === '--smoke') {
      smoke = true;
    } else if (a === '--no-report') {
      noReport = true;
    } else if (a === '--verify') {
      verify = true;
    } else if (a === '--gates-e24') {
      gatesE24 = true;
    } else if (a === '--block-sync') {
      blockSync = true;
    }
  }

  if (smoke && gatesE24) {
    throw new Error('--smoke cannot be combined with --gates-e24');
  }

  if (smoke) {
    tiersStr = E23_SMOKE_TIER;
    iters = E23_SMOKE_ITERS;
    noReport = true;
    if (!outProvided) {
      outJsonl = path.join(os.tmpdir(), 'e2-smoke.jsonl');
    }
  }

  if (gatesE24) {
    tiersStr = 'all';
    iters = 30;
    if (!outProvided) {
      outJsonl = defaultE2JsonlPath;
    }
  }

  const tiers = parseTiersArg(tiersStr);

  if (gatesE24) {
    const want = JSON.stringify(payload.E2_TIER_ORDER);
    const got = JSON.stringify(tiers);
    if (want !== got) {
      throw new Error(
        '--gates-e24 requires all five tiers in default order (omit --tiers or use --tiers all)'
      );
    }
    if (iters !== 30) {
      throw new Error('--gates-e24 requires --iters 30');
    }
    const resolved = path.normalize(path.resolve(outJsonl));
    const wantPath = path.normalize(path.resolve(defaultE2JsonlPath));
    if (resolved !== wantPath) {
      throw new Error(
        `--gates-e24 requires JSONL at ${wantPath}; got ${resolved} (omit --out for default)`
      );
    }
  }

  return {
    help: false,
    tiers,
    iters,
    outJsonl,
    smoke,
    outProvided,
    noReport,
    verify,
    gatesE24,
    blockSync
  };
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

  const runId = process.env.PERF_RUN_ID || crypto.randomBytes(8).toString('hex');
  const rsFile = path.join(
    os.tmpdir(),
    `perf-e2-recordstore-${runId}-${process.pid}-${Date.now()}.json`
  );
  configurePerfEnv({ RECORD_STORE_PATH: rsFile });

  const jsonlOut = args.outJsonl;
  const wallClockT0 = Date.now();
  const isoStart = new Date().toISOString();

  fs.mkdirSync(path.dirname(jsonlOut), { recursive: true });
  if (fs.existsSync(jsonlOut)) {
    fs.unlinkSync(jsonlOut);
  }

  console.log(
    `E2 · tiers=${args.tiers.join(',')} itersPerTier=${args.iters} runId=${runId}${args.blockSync ? ' block-sync=ON' : ''}`
  );

  const policeToken = await acquirePoliceToken();

  let globalI = 0;
  const logicalRows = [];

  for (const sizeTier of args.tiers) {
    const targetBytes = payload.E2_TIER_BYTES[sizeTier];
    for (let j = 0; j < args.iters; j++) {
      const caseId = `perf-e2-${runId}-${sizeTier}-${j}`;
      const generatedAt = new Date().toISOString();
      const { caseJson, aggregateHash, utf8Len } = payload.genAtBand(targetBytes, caseId);

      const r = await uploadOnce(policeToken, {
        caseId,
        examiner: 'officer1',
        aggregateHash,
        generatedAt,
        caseJson,
        blockSync: args.blockSync
      });

      // Prevent cumulative record store growth: each save() re-serialises the entire store.
      // After timing is captured, delete the store so the next iteration starts fresh.
      try { fs.unlinkSync(rsFile); } catch {}
      // Release large buffers held by supertest/express parser before next iteration.
      if (typeof global.gc === 'function') global.gc();

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

      const row = {
        experiment: 'E2',
        i: globalI,
        iterInTier: j,
        sizeTier,
        targetBytes,
        ts: generatedAt,
        runId,
        caseId,
        blockSync: args.blockSync,
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
      globalI += 1;
    }
  }

  const okCount = logicalRows.filter((z) => z.ok).length;
  const total = logicalRows.length;
  console.log(`E2 done · ${okCount}/${total} ok · jsonl=${jsonlOut}`);

  let exitCode = okCount >= total ? 0 : 3;

  if (args.smoke && exitCode === 0) {
    try {
      assertE2SmokeRows(logicalRows);
    } catch (e) {
      console.error(e.message || String(e));
      exitCode = 22;
    }
  }

  if (!args.smoke && !args.noReport && okCount > 0 && exitCode === 0) {
    const csvPath = path.join(defaultResultDir, 'e2-sizes.csv');
    const mdPath = path.join(defaultResultDir, 'e2-sizes.md');
    const { lines, summaries, rIntegrity, gates, legacyTiming } = buildE2CsvLines(logicalRows, {
      includeHeader: true
    });
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
    console.log(formatE2LineVisualization(summaries).join('\n'));
    const jl = countJsonlNonEmptyLines(jsonlOut);
    writeE2SizesMarkdownFile(mdPath, {
      summaries,
      rIntegrity,
      isoStart,
      runId,
      tiers: args.tiers,
      itersPerTier: args.iters,
      jsonlPath: jsonlOut,
      jsonlNonEmptyLines: jl,
      logicalRowCount: logicalRows.length,
      legacyTiming
    });
    if (jl !== logicalRows.length) {
      console.error(
        `E2 JSONL line mismatch: non-empty lines=${jl}, in-memory rows=${logicalRows.length} (${jsonlOut})`
      );
      exitCode = 41;
    }
    console.log(`E2 csv=${csvPath}`);
    console.log(`E2 md =${mdPath}`);
    console.log(`E2.5 gate_all_ok=${gates.ok} Pearson_r=${rIntegrity}`);
    if (args.verify && !gates.ok) {
      console.error(`[E2.5] gate failures: ${(gates.fails || []).join(' | ')}`);
      exitCode = 37;
    }
  }

  if (args.gatesE24 && exitCode === 0) {
    if (okCount !== 150) {
      console.error(`[E2.4] expected 150 ok uploads, got ${okCount}`);
      exitCode = 39;
    } else {
      const wallMs = Date.now() - wallClockT0;
      if (wallMs > 12 * 60 * 1000) {
        console.error(`[E2.4] wall-clock ${wallMs} ms exceeds 12 min budget`);
        exitCode = 38;
      } else {
        console.log(`[E2.4 full] gates ok (${wallMs} ms wall, JSONL ${jsonlOut})`);
      }
    }
  }

  if (args.smoke && exitCode === 0) {
    console.log(`[E2 smoke] tier=${E23_SMOKE_TIER} ${okCount}/${total} ok ts=${new Date().toISOString()}`);
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
