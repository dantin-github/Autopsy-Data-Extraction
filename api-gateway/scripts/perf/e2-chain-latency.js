'use strict';

/**
 * E2.6 — Chain Latency Micro-Benchmark
 *
 * Two arms, both run directly in-process (no HTTP, no file I/O before each call):
 *   crud     — chain.insertRecord()                    → chainMs baseline
 *   registry — chain.createCaseRegistryRecordFromKeystore() → caseRegistryMs baseline
 *
 * Eliminates bimodal contamination seen in E2 where variable recordStoreMs (disk I/O)
 * lands at random offsets in FISCO BCOS's block-sealing interval.
 *
 * Usage:
 *   npm run perf:e2:chain-latency
 *   npm run perf:e2:chain-latency:smoke
 *   npm run perf:e2:chain-latency:full
 *   node scripts/perf/e2-chain-latency.js [options]
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const { configurePerfEnv } = require('./lib/harness');

const apiRoot = path.join(__dirname, '..', '..');
const defaultResultDir = path.join(apiRoot, '..', 'docs', 'evidence', 'perf', 'results', 'E2');
const defaultJsonl = path.join(defaultResultDir, 'e2-chain-latency.jsonl');

function usage() {
  console.log(`
E2.6 chain latency micro-benchmark (CRUD arm + Registry arm)

Usage:
  npm run perf:e2:chain-latency [-- options]
  node scripts/perf/e2-chain-latency.js [options]

Options:
  --iters <n>    Measured calls per arm (default 100)
  --warmup <n>   Warm-up calls per arm (default 5)
  --out <file>   JSONL path (default docs/evidence/perf/results/E2b/e2b-chain-latency.jsonl)
  --smoke        Quick sanity: 3 warm-ups + 5 measured per arm

Registry arm runs only when CASE_REGISTRY_ADDR is configured.
Set PERF_SIGNING_PASSWORD and PERF_POLICE_USER_ID as needed (default: '1' / 'u-police-1').
`);
}

function writeJsonl(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

function parseArgs(argv) {
  let iters = 100;
  let warmup = 5;
  let outJsonl = defaultJsonl;
  let smoke = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--iters') { iters = Math.max(1, Number(argv[++i])); }
    else if (a === '--warmup') { warmup = Math.max(0, Number(argv[++i])); }
    else if (a === '--out') { outJsonl = path.resolve(String(argv[++i])); }
    else if (a === '--smoke') { smoke = true; }
  }
  if (smoke) {
    warmup = 3;
    iters = 5;
    outJsonl = path.join(os.tmpdir(), 'e2-chain-latency-smoke.jsonl');
  }
  return { help: false, iters, warmup, outJsonl, smoke };
}

function buildStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(p * n / 100))];
  return {
    n,
    mean: Math.round(mean * 100) / 100,
    sd: Math.round(sd * 100) / 100,
    cv: mean > 0 ? Math.round((sd / mean) * 1000) / 1000 : null,
    min: sorted[0],
    p25: pct(25),
    p50: pct(50),
    p75: pct(75),
    p95: pct(95),
    p99: pct(99),
    max: sorted[n - 1]
  };
}

function buildHistogram(values, buckets = 10) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ lo: min, hi: max, count: values.length }];
  const step = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    lo: Math.round(min + i * step),
    hi: Math.round(min + (i + 1) * step),
    count: 0
  }));
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / step));
    bins[idx].count++;
  }
  return bins;
}

function printStats(label, stats, hist) {
  console.log(`\n${label}:`);
  console.log(`  n=${stats.n}  mean=${stats.mean}ms  sd=${stats.sd}ms  cv=${stats.cv}`);
  console.log(`  p25=${stats.p25}  p50=${stats.p50}  p75=${stats.p75}  p95=${stats.p95}  p99=${stats.p99}`);
  console.log(`  min=${stats.min}  max=${stats.max}`);
  console.log('  Histogram:');
  const maxCount = Math.max(...hist.map((b) => b.count));
  for (const b of hist) {
    const bar = '█'.repeat(Math.round((b.count / maxCount) * 25));
    console.log(`    [${String(b.lo).padStart(5)}-${String(b.hi).padStart(5)}ms] ${String(b.count).padStart(3)} ${bar}`);
  }
}

function statsTableMd(stats) {
  return [
    `| Metric | Value |`,
    `|--------|-------|`,
    `| n | ${stats.n} |`,
    `| mean | ${stats.mean} ms |`,
    `| sd | ${stats.sd} ms |`,
    `| CV | ${stats.cv} |`,
    `| min | ${stats.min} ms |`,
    `| p25 | ${stats.p25} ms |`,
    `| p50 (median) | ${stats.p50} ms |`,
    `| p75 | ${stats.p75} ms |`,
    `| p95 | ${stats.p95} ms |`,
    `| p99 | ${stats.p99} ms |`,
    `| max | ${stats.max} ms |`,
  ].join('\n');
}

function histTableMd(hist) {
  const maxCount = Math.max(...hist.map((b) => b.count));
  const header = `| Range (ms) | Count | Bar |\n|------------|-------|-----|`;
  const rows = hist.map(
    (b) => `| ${b.lo}–${b.hi} | ${b.count} | ${'█'.repeat(Math.round((b.count / maxCount) * 20))} |`
  );
  return [header, ...rows].join('\n');
}

/** Run one arm: warmup then measure, return { rows, values } */
async function runArm({ arm, label, iters, warmup, runId, callFn, hashOnly, jsonlOut }) {
  console.log(`\n[${label}]`);
  if (warmup > 0) {
    process.stdout.write(`  warm-up (${warmup} calls)...`);
    for (let w = 0; w < warmup; w++) {
      const wId = `e2b-${arm}-warmup-${runId}-${w}`;
      const iH = hashOnly.computeIndexHash(wId);
      const rH = hashOnly.computeRecordHash(wId, '{}', '0x00', 'warmup', new Date().toISOString());
      await callFn(iH, rH, wId);
    }
    console.log(' done');
  }

  const values = [];
  const rows = [];

  for (let i = 0; i < iters; i++) {
    const caseId = `e2b-${arm}-${runId}-${i}`;
    const ts = new Date().toISOString();
    const iH = hashOnly.computeIndexHash(caseId);
    const rH = hashOnly.computeRecordHash(caseId, '{}', '0x00', 'e2b', ts);

    const t0 = process.hrtime.bigint();
    let ok = false;
    let txHash = null;
    let blockNumber = null;
    let errMsg = null;
    try {
      const res = await callFn(iH, rH, caseId);
      txHash = res.txHash;
      blockNumber = res.blockNumber;
      ok = true;
    } catch (e) {
      errMsg = e && e.message ? e.message : String(e);
    }
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n);

    if (ok) values.push(ms);

    const row = {
      experiment: 'E2.6',
      arm,
      i,
      runId,
      caseId,
      ts,
      ok,
      ms: ok ? ms : null,
      txHash: ok ? txHash : null,
      blockNumber: ok ? blockNumber : null,
      errMsg: ok ? null : errMsg
    };
    writeJsonl(jsonlOut, row);
    rows.push(row);

    if ((i + 1) % 10 === 0 || i === iters - 1) {
      process.stdout.write(`\r  measured ${i + 1}/${iters}...`);
    }
  }
  console.log('');
  return { rows, values };
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
  if (args.help) { usage(); process.exit(0); return; }

  configurePerfEnv();

  const chain = require(path.join(apiRoot, 'src', 'services', 'chain'));
  const config = require(path.join(apiRoot, 'src', 'config'));

  if (!chain.isChainConfigured()) {
    console.error('Chain not configured. Gaps:');
    for (const g of chain.getChainConfigGaps()) console.error(' ', g);
    process.exit(1);
    return;
  }

  const registryEnabled = config.uploadContractEnabled();
  const userId =
    process.env.PERF_POLICE_USER_ID && String(process.env.PERF_POLICE_USER_ID).trim()
      ? String(process.env.PERF_POLICE_USER_ID).trim()
      : 'u-police-1';
  const signingPassword = process.env.PERF_SIGNING_PASSWORD || '1';

  const runId = crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(path.dirname(args.outJsonl), { recursive: true });
  if (fs.existsSync(args.outJsonl)) fs.unlinkSync(args.outJsonl);

  console.log(
    `E2b · warmup=${args.warmup} iters=${args.iters} runId=${runId}` +
    `  registry=${registryEnabled ? 'ON' : 'OFF (CASE_REGISTRY_ADDR not set)'}`
  );

  const hashOnly = require(path.join(apiRoot, 'src', 'services', 'hashOnly'));

  // ── Arm A: CRUD (chain.insertRecord) ──────────────────────────────────────
  const crudCallFn = async (indexHash, recordHash) =>
    chain.insertRecord({ indexHash, recordHash });

  const crud = await runArm({
    arm: 'crud', label: 'Arm A · CRUD (chain.insertRecord)',
    iters: args.iters, warmup: args.warmup, runId,
    callFn: crudCallFn, hashOnly, jsonlOut: args.outJsonl
  });

  const crudOkCount = crud.rows.filter((r) => r.ok).length;
  console.log(`  crud done · ${crudOkCount}/${args.iters} ok`);

  // ── Arm B: Registry ────────────────────────────────────────────────────────
  let reg = null;
  let regOkCount = 0;
  if (registryEnabled) {
    const regCallFn = async (indexHashHex, recordHashHex, caseId) =>
      chain.createCaseRegistryRecordFromKeystore({
        userId,
        signingPassword,
        indexHashHex,
        recordHashHex
      });

    reg = await runArm({
      arm: 'registry', label: 'Arm B · Registry (createCaseRegistryRecordFromKeystore)',
      iters: args.iters, warmup: args.warmup, runId,
      callFn: regCallFn, hashOnly, jsonlOut: args.outJsonl
    });
    regOkCount = reg.rows.filter((r) => r.ok).length;
    console.log(`  registry done · ${regOkCount}/${args.iters} ok`);
  } else {
    console.log('\n[Arm B · Registry] SKIPPED — CASE_REGISTRY_ADDR not configured');
  }

  console.log(`\nE2b done · jsonl=${args.outJsonl}`);

  if (crudOkCount === 0) {
    console.error('No successful CRUD samples. Check chain config.');
    process.exit(3);
    return;
  }

  // ── Stats & output ─────────────────────────────────────────────────────────
  const crudStats = buildStats(crud.values);
  const crudHist = buildHistogram(crud.values, 10);
  printStats('chainMs (CRUD arm)', crudStats, crudHist);

  let regStats = null;
  let regHist = null;
  if (reg && reg.values.length) {
    regStats = buildStats(reg.values);
    regHist = buildHistogram(reg.values, 10);
    printStats('caseRegistryMs (Registry arm)', regStats, regHist);
  }

  // ── Markdown ───────────────────────────────────────────────────────────────
  const mdPath = path.join(path.dirname(args.outJsonl), '..', 'e2-chain-latency.md');

  const cvNote = (stats, label) =>
    stats && stats.cv != null && stats.cv > 0.5
      ? `\n> **Note (${label})**: CV = ${stats.cv} (> 0.5) — non-uniform distribution. Use p50.\n`
      : '';

  const regSection = regStats
    ? [
        ``,
        `## Arm B — Registry (\`caseRegistryMs\`)`,
        ``,
        `Calls \`chain.createCaseRegistryRecordFromKeystore()\` directly.`,
        ``,
        cvNote(regStats, 'caseRegistryMs'),
        statsTableMd(regStats),
        ``,
        histTableMd(regHist),
      ].join('\n')
    : `\n## Arm B — Registry\n\nSKIPPED — \`CASE_REGISTRY_ADDR\` not configured.\n`;

  const deltaLine =
    regStats
      ? `Δ (registry − crud) p50: **${regStats.p50 - crudStats.p50} ms**`
      : '';

  const mdLines = [
    `# E2b — Chain Latency Micro-Benchmark`,
    ``,
    `Run ID: \`${runId}\`  `,
    `Samples per arm: ${args.iters} (warmup: ${args.warmup})  `,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `| Arm | Metric | mean | sd | CV | p50 | p95 |`,
    `|-----|--------|------|----|----|-----|-----|`,
    `| CRUD | chainMs | ${crudStats.mean} ms | ${crudStats.sd} ms | ${crudStats.cv} | ${crudStats.p50} ms | ${crudStats.p95} ms |`,
    regStats
      ? `| Registry | caseRegistryMs | ${regStats.mean} ms | ${regStats.sd} ms | ${regStats.cv} | ${regStats.p50} ms | ${regStats.p95} ms |`
      : `| Registry | caseRegistryMs | N/A | N/A | N/A | N/A | N/A |`,
    ``,
    deltaLine,
    ``,
    `## Arm A — CRUD (\`chainMs\`)`,
    ``,
    `Calls \`chain.insertRecord()\` directly (no preceding I/O).`,
    ``,
    cvNote(crudStats, 'chainMs'),
    statsTableMd(crudStats),
    ``,
    histTableMd(crudHist),
    regSection,
    ``,
    `## Interpretation`,
    ``,
    `Both arms bypass the HTTP upload route and skip all file I/O, isolating pure chain latency.`,
    ``,
    `**Thesis note**: In E2 (case-size scaling), \`chainMs\` and \`caseRegistryMs\` appear to decrease`,
    `at large file tiers because heavy \`recordStoreMs\` disk I/O shifts the phase relationship with`,
    `FISCO BCOS's block-sealing timer.  The underlying chain cost is constant (only fixed-size hashes`,
    `go on-chain); p50 values from this E2b benchmark are the canonical latency references.`,
  ];

  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(
    mdPath,
    mdLines.filter((l) => l !== undefined).join('\n') + '\n',
    'utf8'
  );
  console.log(`\nMarkdown: ${mdPath}`);

  const allOk = crudOkCount === args.iters && (!reg || regOkCount === args.iters);
  process.exit(allOk ? 0 : 3);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
});
