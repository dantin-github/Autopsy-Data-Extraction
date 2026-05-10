'use strict';

/**
 * E1.4: aggregate JSONL rows into stats + CSV lines (shared by e1-breakdown.js and offline runner).
 */

const fs = require('fs');
const stats = require('./stats');
const { vizBar, writeSevenSectionReport } = require('./reportMd');
const { residualUploadMs } = require('./e2Aggregate');

/**
 * @param {string} jsonlPath
 * @returns {object[]}
 */
function loadE1Jsonl(jsonlPath) {
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
      throw new Error(`E1 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

/** @param {{ ok: boolean }[]} logicalRows */
function summarizeE1Rows(logicalRows) {
  const rows = logicalRows.filter((x) => x.ok);
  const pick = (fn) => {
    const vals = rows.map(fn).filter(Number.isFinite);
    return vals.length
      ? stats.quantiles(vals)
      : { n: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  };
  return {
    integrity: pick((r) => r.integrityMs),
    localHash: pick((r) =>
      Number.isFinite(r.localHashMs) ? r.localHashMs : 0
    ),
    recordStore: pick((r) =>
      Number.isFinite(r.recordStoreMs) ? r.recordStoreMs : 0
    ),
    chain: pick((r) => r.chainMs),
    caseReg: pick((r) =>
      Number.isFinite(r.caseRegistryMs) ? r.caseRegistryMs : 0
    ),
    residual: pick((r) => {
      const v = residualUploadMs(r);
      return Number.isFinite(v) ? v : NaN;
    }),
    totalR: pick((r) => r.totalMs),
    client: pick((r) => r.clientRoundTripMs)
  };
}

/**
 * Verify E1.4 acceptance: summary totalMs p50 matches direct quantile on ok rows.
 * @param {{ ok: boolean, totalMs?: number }[]} logicalRows
 * @param {{ totalR: { p50: number } }} m
 */
function verifyTotalMsP50Tolerance(logicalRows, m) {
  const vals = logicalRows
    .filter((r) => r.ok)
    .map((r) => r.totalMs)
    .filter(Number.isFinite);
  if (vals.length === 0) {
    return { ok: false, delta: NaN, direct: NaN, summary: m.totalR.p50 };
  }
  const direct = stats.quantiles(vals).p50;
  const delta = Math.abs(direct - m.totalR.p50);
  return { ok: delta < 1, delta, direct, summary: m.totalR.p50 };
}

/**
 * One CSV summary line (starts with #) with explicit totalMs_p50 for E1.4 acceptance / grep.
 * @param { ReturnType<summarizeE1Rows> } m
 */
function formatE1SummaryLine(m, iters, okCount) {
  const parts = [
    'tag=summary',
    `iters=${iters}`,
    `ok=${okCount}`,
    `integrityMs_mean=${m.integrity.mean}`,
    `integrityMs_p50=${m.integrity.p50}`,
    `integrityMs_p95=${m.integrity.p95}`,
    `integrityMs_p99=${m.integrity.p99}`,
    `localHashMs_mean=${m.localHash.mean}`,
    `localHashMs_p50=${m.localHash.p50}`,
    `localHashMs_p95=${m.localHash.p95}`,
    `localHashMs_p99=${m.localHash.p99}`,
    `recordStoreMs_mean=${m.recordStore.mean}`,
    `recordStoreMs_p50=${m.recordStore.p50}`,
    `recordStoreMs_p95=${m.recordStore.p95}`,
    `recordStoreMs_p99=${m.recordStore.p99}`,
    `chainMs_mean=${m.chain.mean}`,
    `chainMs_p50=${m.chain.p50}`,
    `chainMs_p95=${m.chain.p95}`,
    `chainMs_p99=${m.chain.p99}`,
    `caseRegistryMs_mean=${m.caseReg.mean}`,
    `caseRegistryMs_p50=${m.caseReg.p50}`,
    `caseRegistryMs_p95=${m.caseReg.p95}`,
    `caseRegistryMs_p99=${m.caseReg.p99}`,
    `residualMs_mean=${m.residual.mean}`,
    `residualMs_p50=${m.residual.p50}`,
    `residualMs_p95=${m.residual.p95}`,
    `residualMs_p99=${m.residual.p99}`,
    `totalMs_mean=${m.totalR.mean}`,
    `totalMs_p50=${m.totalR.p50}`,
    `totalMs_p95=${m.totalR.p95}`,
    `totalMs_p99=${m.totalR.p99}`,
    `clientRoundTripMs_mean=${m.client.mean}`,
    `clientRoundTripMs_p50=${m.client.p50}`,
    `clientRoundTripMs_p95=${m.client.p95}`,
    `clientRoundTripMs_p99=${m.client.p99}`,
    `integrity_p50=${m.integrity.p50}`,
    `localHash_p50=${m.localHash.p50}`,
    `recordStore_p50=${m.recordStore.p50}`,
    `chain_p50=${m.chain.p50}`,
    `caseRegistry_p50=${m.caseReg.p50}`,
    `residual_p50=${m.residual.p50}`,
    `total_p50=${m.totalR.p50}`,
    `client_p50=${m.client.p50}`
  ];
  return `# ${parts.join(',')}`;
}

/**
 * @returns {{ lines: string[], m: ReturnType<summarizeE1Rows> }}
 */
function buildE1CsvLines(logicalRows, { iters, okCount, includeHeader = true }) {
  const lines = [];
  if (includeHeader) {
    lines.push(
      [
        'experiment',
        'index',
        'ok',
        'httpStatus',
        'utf8Approx',
        'integrityMs',
        'localHashMs',
        'recordStoreMs',
        'chainMs',
        'caseRegistryMs',
        'residualMs',
        'totalMs',
        'clientRoundTripMs',
        'blockNumber',
        'requestId',
        'caseId'
      ].join(',')
    );
  }

  for (const r of logicalRows) {
    lines.push(
      [
        r.experiment,
        r.i,
        r.ok ? 1 : 0,
        r.httpStatus,
        r.utf8Approx,
        r.integrityMs,
        r.localHashMs,
        r.recordStoreMs,
        r.chainMs,
        r.caseRegistryMs,
        r.residualMs,
        r.totalMs,
        r.clientRoundTripMs,
        r.blockNumber,
        `"${String(r.requestId).replace(/"/g, '')}"`,
        `"${String(r.caseId).replace(/"/g, '')}"`
      ].join(',')
    );
  }

  const m = summarizeE1Rows(logicalRows);
  lines.push(formatE1SummaryLine(m, iters, okCount));
  return { lines, m };
}

function formatE1StackedBarLines(m) {
  const denom = Math.max(m.totalR.p50, 1e-9);
  const rows = [
    ['integrityMs     ', m.integrity.p50],
    ['localHashMs     ', m.localHash.p50],
    ['recordStoreMs   ', m.recordStore.p50],
    ['chainMs         ', m.chain.p50],
    ['caseRegistryMs  ', m.caseReg.p50],
    ['residualMs      ', m.residual.p50]
  ];
  return rows.map(
    ([label, ms]) =>
      `${label} ${vizBar(Math.min(ms / denom, 1), `${Number(ms).toFixed(1)} ms`)}`
  );
}

function printE1StackedBarStdout(m) {
  console.log(formatE1StackedBarLines(m).join('\n'));
}

/**
 * @param {ReturnType<summarizeE1Rows>} m
 * @returns {{ p50: number, p95: number }}
 */
function computeChainRegistrySharePct(m) {
  const d50 = Math.max(m.totalR.p50, 1e-9);
  const d95 = Math.max(m.totalR.p95, 1e-9);
  const s50 = m.chain.p50 + m.caseReg.p50;
  const s95 = m.chain.p95 + m.caseReg.p95;
  return {
    p50: (s50 / d50) * 100,
    p95: (s95 / d95) * 100
  };
}

function formatE1ResultsMarkdownTable(m) {
  return `
**Table E1.1: Latency decomposition (successful uploads, milliseconds)**

Same gateway timing fields as E2: \`integrityMs\` = aggregate-hash verify; \`localHashMs\` = index/record hash prep; \`recordStoreMs\` = private store write; \`chainMs\` = CRUD insert RTT; \`residualMs\` = remainder of \`totalMs\` (reconcile, block timestamp lookup, rounding).

| metric | mean | p50 | p95 | p99 |
| :--- | :---: | :---: | :---: | :---: |
| integrityMs | ${m.integrity.mean.toFixed(2)} | ${m.integrity.p50.toFixed(2)} | ${m.integrity.p95.toFixed(2)} | ${m.integrity.p99.toFixed(2)} |
| localHashMs | ${m.localHash.mean.toFixed(2)} | ${m.localHash.p50.toFixed(2)} | ${m.localHash.p95.toFixed(2)} | ${m.localHash.p99.toFixed(2)} |
| recordStoreMs | ${m.recordStore.mean.toFixed(2)} | ${m.recordStore.p50.toFixed(2)} | ${m.recordStore.p95.toFixed(2)} | ${m.recordStore.p99.toFixed(2)} |
| chainMs | ${m.chain.mean.toFixed(2)} | ${m.chain.p50.toFixed(2)} | ${m.chain.p95.toFixed(2)} | ${m.chain.p99.toFixed(2)} |
| caseRegistryMs | ${m.caseReg.mean.toFixed(2)} | ${m.caseReg.p50.toFixed(2)} | ${m.caseReg.p95.toFixed(2)} | ${m.caseReg.p99.toFixed(2)} |
| residualMs | ${m.residual.mean.toFixed(2)} | ${m.residual.p50.toFixed(2)} | ${m.residual.p95.toFixed(2)} | ${m.residual.p99.toFixed(2)} |
| totalMs (gateway) | ${m.totalR.mean.toFixed(2)} | ${m.totalR.p50.toFixed(2)} | ${m.totalR.p95.toFixed(2)} | ${m.totalR.p99.toFixed(2)} |
| clientRoundTripMs | ${m.client.mean.toFixed(2)} | ${m.client.p50.toFixed(2)} | ${m.client.p95.toFixed(2)} | ${m.client.p99.toFixed(2)} |
`.trim();
}

/**
 * Plan E1.5: bullets use the same aggregates as the CSV summary row (E1.4).
 */
function formatE1KeyObservationBullets(m, logicalRows) {
  const sh = computeChainRegistrySharePct(m);
  const samples = logicalRows
    .filter((z) => z.ok && z.requestId)
    .slice(0, 3)
    .map((z) => z.requestId);
  const sid = samples.length ? samples.join(', ') : '(none)';
  return [
    `Combined on-chain stages (chainMs + caseRegistryMs) account for ${sh.p50.toFixed(1)}% of gateway totalMs at p50 (E1.4 CSV summary, p50).`,
    `Combined on-chain stages account for ${sh.p95.toFixed(1)}% of gateway totalMs at p95 (E1.4 CSV summary, p95).`,
    `Examiner-visible clientRoundTripMs p50 is ${m.client.p50.toFixed(2)} ms (E1.4 summary, p50).`,
    `Sample requestIds for upload_timing correlation: ${sid} (E1.4 raw JSONL, first three ok rows).`
  ];
}

/**
 * §4.1 seven-section report (Purpose … Cross-refs).
 * @param {{ offline?: { rows: number, ok: number } | null }} opts
 */
function writeE1BreakdownMarkdownFile(absPath, opts) {
  const {
    m,
    logicalRows,
    isoStart,
    recordStorePath,
    iters,
    targetBytes,
    sizeHuman,
    offline
  } = opts;

  let methodLines;
  if (offline) {
    const fr = offline.fileRows != null ? offline.fileRows : offline.rows;
    const pr = offline.parsedRows != null ? offline.parsedRows : offline.rows;
    const mismatch =
      Number.isFinite(fr) && Number.isFinite(pr) && fr !== pr;
    methodLines = [
      '- Offline report from existing JSONL (E1.5); no new uploads.',
      `- JSONL file ${offline.fileBase || 'e1-breakdown.jsonl'}: ${fr} non-empty line(s); ${pr} JSON object(s) parsed; ${offline.ok} row(s) with ok=true.`,
      ...(mismatch
        ? [
            '- **Warning:** parsed JSON count ≠ non-empty line count — inspect the JSONL for invalid or truncated lines.'
          ]
        : []),
      '- Live reproduction: `npm run perf:e1` or `npm run perf:e1:full` (see `api-gateway/scripts/perf/README.md`).',
      '',
      '`npm run perf:e1:csv-from-jsonl` regenerates CSV; `npm run perf:e1:md-from-jsonl` regenerates this file.'
    ];
  } else {
    methodLines = [
      '- Sequential POST /api/upload, X-Debug-Timing: 1, contract mode when enabled.',
      `- iters=${iters}, target caseJson UTF-8 size ${targetBytes}B (${sizeHuman}), RECORD_STORE_TEMP=${recordStorePath}.`,
      `- startedAt=${isoStart} (UTC-ish ISO), gateway token reuse (X_AUTH_TOKEN_SINGLE_USE=0).`,
      '',
      `\`npm run perf:e1 -- --iters ${iters} --size ${sizeHuman}\``
    ];
  }

  const tbl = formatE1ResultsMarkdownTable(m);
  const vizBlock = formatE1StackedBarLines(m).join('\n');
  const bullets = formatE1KeyObservationBullets(m, logicalRows);

  writeSevenSectionReport(absPath, {
    titleLine: `# E1 · Latency breakdown`,
    purpose:
      'Maps RQ 2.2 / 2.3: separates integrity verification vs on-chain steps vs examiner-visible latency.',
    methodLines,
    resultTablesMarkdown: tbl,
    vizBlock,
    bullets,
    artifactsLines: [
      '- [Raw JSONL](./E1/e1-breakdown.jsonl)',
      '- [Aggregated CSV](./e1-breakdown.csv)',
      '- `npm run perf:e1:csv-from-jsonl` (E1.4 offline CSV from JSONL)',
      '- `npm run perf:e1:md-from-jsonl` (E1.5 offline MD from JSONL)'
    ],
    crossrefsLines: [
      '- [Chapter 4.3 performance fields (upload timing)](../../../../Chapter_4_4.3_EN.md)',
      '- Companion: [E4 impact](./e4-impact.md)'
    ]
  });
}

module.exports = {
  loadE1Jsonl,
  summarizeE1Rows,
  verifyTotalMsP50Tolerance,
  formatE1SummaryLine,
  buildE1CsvLines,
  printE1StackedBarStdout,
  formatE1StackedBarLines,
  computeChainRegistrySharePct,
  formatE1ResultsMarkdownTable,
  formatE1KeyObservationBullets,
  writeE1BreakdownMarkdownFile
};
