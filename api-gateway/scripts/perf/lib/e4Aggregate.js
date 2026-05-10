'use strict';

/**
 * E4.5 / E4.6: aggregate JSONL (variant real/mock) → CSV + Markdown deltas.
 */

const fs = require('fs');
const path = require('path');

const stats = require('./stats');
const { vizBar, writeSevenSectionReport } = require('./reportMd');

function loadE4Jsonl(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') {
      continue;
    }
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      throw new Error(`E4 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

function chainRegSum(r) {
  const ch = Number.isFinite(Number(r.chainMs)) ? Number(r.chainMs) : 0;
  const cr = Number.isFinite(Number(r.caseRegistryMs)) ? Number(r.caseRegistryMs) : 0;
  return ch + cr;
}

function quantifyVariant(rows, variant) {
  const sub = rows.filter(
    (r) => String(r.variant) === variant && r.ok === true && Number(r.httpStatus) === 200
  );
  const totalMs = stats.quantiles(sub.map((z) => Number(z.totalMs)).filter(Number.isFinite));
  const cr = stats.quantiles(sub.map((z) => chainRegSum(z)).filter(Number.isFinite));
  return { variant, count: sub.length, totalMs: totalMs, chainRegMs: cr };
}

function nf(x) {
  return Number.isFinite(x) ? Number(x).toFixed(4) : 'nan';
}

/**
 * Build real / mock / delta summary metrics.
 */
function summarizeE4Ab(rows) {
  const qReal = quantifyVariant(rows, 'real');
  const qMock = quantifyVariant(rows, 'mock');

  /** @typedef {{variant:string,count:number,p50:number,p95:number,chp50:number,chp95:number}} Brief */
  /** @type {Brief[]} */
  const triple = [];

  triple.push({
    variant: 'real',
    count: qReal.count,
    p50: qReal.totalMs.p50,
    p95: qReal.totalMs.p95,
    chp50: qReal.chainRegMs.p50,
    chp95: qReal.chainRegMs.p95
  });

  triple.push({
    variant: 'mock',
    count: qMock.count,
    p50: qMock.totalMs.p50,
    p95: qMock.totalMs.p95,
    chp50: qMock.chainRegMs.p50,
    chp95: qMock.chainRegMs.p95
  });

  const d50 = triple[0].p50 - triple[1].p50;
  const d95 = triple[0].p95 - triple[1].p95;
  const dc50 = triple[0].chp50 - triple[1].chp50;
  const dc95 = triple[0].chp95 - triple[1].chp95;

  triple.push({
    variant: 'delta',
    count: '--',
    p50: d50,
    p95: d95,
    chp50: dc50,
    chp95: dc95
  });

  let deltaPctMedian = NaN;
  if (Number.isFinite(d50) && Number.isFinite(triple[0].p50) && Math.abs(triple[0].p50) > 1e-6) {
    deltaPctMedian = (d50 / triple[0].p50) * 100;
  }

  return {
    triple,
    deltaPctMedian,
    qReal,
    qMock
  };
}

function csvHeaderLine() {
  return [
    'variant',
    'count',
    'totalMs_p50',
    'totalMs_p95',
    'chainReg_p50',
    'chainReg_p95'
  ].join(',');
}

/**
 * Rows: variant real/mock/delta rows with delta_* filled only on delta line.
 */
function buildE4CsvLines(rows) {
  const { triple, deltaPctMedian } = summarizeE4Ab(rows);

  /** @type {string[]} */
  const lines = [];

  lines.push(csvHeaderLine());

  lines.push(
    [
      triple[0].variant,
      triple[0].count,
      nf(triple[0].p50),
      nf(triple[0].p95),
      nf(triple[0].chp50),
      nf(triple[0].chp95)
    ].join(',')
  );
  lines.push(
    [
      triple[1].variant,
      triple[1].count,
      nf(triple[1].p50),
      nf(triple[1].p95),
      nf(triple[1].chp50),
      nf(triple[1].chp95)
    ].join(',')
  );
  lines.push(
    [
      triple[2].variant,
      triple[2].count,
      nf(triple[2].p50),
      nf(triple[2].p95),
      nf(triple[2].chp50),
      nf(triple[2].chp95)
    ].join(',')
  );

  const tag = `# tag=summary deltaMedianPct=${Number.isFinite(deltaPctMedian) ? deltaPctMedian.toFixed(4) : 'nan'}`;
  lines.push(tag);

  return { lines: lines, triple, deltaPctMedian };
}

/**
 * Visualization: proportional bars vs max of real/mock p50 totals.
 */
function formatE4Viz(triple) {
  const realP50 = triple[0].p50;
  const mockP50 = triple[1].p50;
  const maxV = Math.max(1e-6, Number(realP50), Number(mockP50), Math.abs(triple[2].p50));
  const lblReal = `${nf(realP50)} ms`;
  const lblMock = `${nf(mockP50)} ms`;
  const lblDelta = `${nf(triple[2].p50)} ms`;
  return [
    `real  ${vizBar(realP50 / maxV, lblReal)}`,
    `mock  ${vizBar(mockP50 / maxV, lblMock)}`,
    `Δ     ${vizBar(Math.abs(triple[2].p50) / maxV, lblDelta)}`
  ].join('\n');
}

/**
 * Two-column core table requested by plan §4 Phase 4.
 */
function resultTableMarkdown(triple) {
  const hdr =
    '| variant | totalMs p50 (ms) | totalMs p95 (ms) | (chainMs+caseRegistryMs) p50 (ms) | (chainMs+caseRegistryMs) p95 (ms) |\n| :--- | ---: | ---: | ---: | ---: |\n';

  function row(t) {
    return `| ${t.variant} | ${nf(t.p50)} | ${nf(t.p95)} | ${nf(t.chp50)} | ${nf(t.chp95)} |`;
  }
  const body = triple.map(row).slice(0, 2).join('\n');
  const deltaNote = `\nThe **delta** row repeats the **real percentile minus mock percentile** for headline CSV alignment.\n`;

  const deltaMd = `\n**Table E4.2: Δ columns (explicit)**\n\n| metric @p50 | value (ms) | metric @p95 | value (ms) |\n| :--- | ---: | :--- | ---: |\n| Δ totalMs | ${nf(triple[2].p50)} | Δ totalMs | ${nf(triple[2].p95)} |\n| Δ chainMs+caseRegistryMs | ${nf(triple[2].chp50)} | Δ chainMs+caseRegistryMs | ${nf(triple[2].chp95)} |\n`;

  return `**Table E4.1: Real vs mocked chain (successful uploads)**\n\n${hdr}${body}\n${deltaMd}${deltaNote}`;
}

/** @typedef {{triple:any[], isoStart:string,reuseE1:boolean,iters:number,targetBytes:number,jsonlBasename:string,realSourceNote:string,e1ComparePct?:number}} WriteOpts */

/**
 * @param {string} absPath
 * @param {WriteOpts} opts
 */
function writeE4ImpactMarkdown(absPath, opts) {
  const {
    triple,
    isoStart,
    reuseE1,
    iters,
    targetBytes,
    jsonlBasename,
    realSourceNote = '',
    e1ComparePct
  } = opts;

  const delta = triple[2];
  const real = triple[0];
  const pctPct =
    Number.isFinite(real.p50) && Math.abs(Number(real.p50)) > 1e-9
      ? `${((Number(delta.p50) / Number(real.p50)) * 100).toFixed(2)}`
      : 'nan';
  const pctMedian = `${pctPct}%`;

  const bullets = [];

  bullets.push(
    `Blockchain-related stages add approximately ${nf(Number(delta.chp50))} ms at the gateway p50 breakdown for \`chainMs + caseRegistryMs\`, i.e., sealer/registry work removed by the stub (E4.5 delta-row, chainReg p50).`
  );

  bullets.push(
    `End-to-end gateway \`totalMs\` differs by median ${nf(Number(delta.p50))} ms (≈ ${pctMedian} of median real latency) between real and mocked runs (E4.5 delta-row, total p50).`
  );

  bullets.push(
    `Tail gap at p95: Δ totalMs ≈ ${nf(Number(delta.p95))} ms; Δ chainReg ≈ ${nf(Number(delta.chp95))} ms (E4.5 delta-row, total p95 / chainReg p95).`
  );

  bullets.push(
    `Attribution caveat: mocked runs skip reconcile \`getRecordHashOnRegistry\` and \`getMirroredRecordHash\` Ethereum calls counted as blockchain integration overhead in real mode (dissertation Section 8 risk note) (E4.6 attribution, reconcile).`
  );

  if (
    reuseE1 &&
    typeof e1ComparePct === 'number' &&
    Number.isFinite(e1ComparePct) &&
    e1ComparePct > 15
  ) {
    bullets.push(
      `Real-branch mean \`totalMs\` versus E1 reference differs by roughly ${e1ComparePct.toFixed(1)}% (same chain, adjacent runs may drift) (E4.4 ingest, drift check).`
    );
  }

  const methodBits = [
    `Two-phase CSV on one host: Phase A uploads \`/api/upload\` with Contract mode + genuine chain timings; Phase B reinstalls harness then \`chainMock.install()\` stubs CRUD/registry before another ${iters} uploads.`,
    `Payload target ≈ ${(targetBytes / 1024).toFixed(0)} KB UTF-8 (match E1 for comparability); X-Debug-Timing enabled.`,
    `Coordinator start UTC: ${isoStart}.`,
    realSourceNote ? realSourceNote : '',
    reuseE1 ? '`--reuse-e1` copies real-variant latency rows from archived E1 JSONL so Phase A skips network duplication.' : '',
    '`npm run perf:e4:aggregate-from-jsonl` regenerates CSV from JSONL offline.'
  ].filter((z) => z !== '');

  const vizBlock = formatE4Viz(triple);

  writeSevenSectionReport(absPath, {
    titleLine: '# E4 · Blockchain integration impact',
    purpose:
      'Answers RQ 2.2 with an A-vs-B subtraction: subtract mocked chain/registry latency from measurements using the identical gateway workload.',
    methodLines: methodBits,
    resultTablesMarkdown: resultTableMarkdown(triple),
    vizBlock,
    bullets,
    artifactsLines: [
      `- [Raw JSONL](./E4/${jsonlBasename})`,
      `- [Delta CSV](./e4-impact.csv)`,
      '- `npm run perf:e4` · `npm run perf:e4:aggregate-from-jsonl` · `npm run perf:e4:md-from-jsonl`'
    ],
    crossrefsLines: [
      '- [Latency breakdown baseline](./e1-breakdown.md)',
      '- [Throughput scaling](./e3-concurrency.md)',
      '- [Chapter 4.3 performance](../../../../Chapter_4_4.3_EN.md)'
    ]
  });
}

module.exports = {
  loadE4Jsonl,
  quantifyVariant,
  summarizeE4Ab,
  buildE4CsvLines,
  chainRegSum,
  writeE4ImpactMarkdown,
  nf
};
