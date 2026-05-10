'use strict';

/**
 * E2.5 / E2.6: aggregate E2 JSONL by sizeTier → CSV + Pearson r (mean integrityMs+localHashMs vs targetBytes).
 */

const fs = require('fs');
const path = require('path');
const stats = require('./stats');
const { vizBar, writeSevenSectionReport } = require('./reportMd');
const payload = require('./payload');

/** @param {string} jsonlPath */
function loadE2Jsonl(jsonlPath) {
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
      throw new Error(`E2 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

/** Non-empty physical lines (for parity with append-only JSONL writers). */
function countJsonlNonEmptyLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return raw.split('\n').filter((l) => l.trim() !== '').length;
}

/**
 * Remainder of totalMs after labelled stages (reconcile, block timestamp lookup, rounding).
 * @param {{ ok?: boolean, totalMs?: number, integrityMs?: number, localHashMs?: number, recordStoreMs?: number, chainMs?: number, caseRegistryMs?: number }} r
 */
function residualUploadMs(r) {
  if (!r.ok || !Number.isFinite(r.totalMs)) {
    return NaN;
  }
  const reg = Number.isFinite(r.caseRegistryMs) ? Number(r.caseRegistryMs) : 0;
  const ih = Number.isFinite(r.integrityMs) ? Number(r.integrityMs) : 0;
  const lh = Number.isFinite(r.localHashMs) ? Number(r.localHashMs) : 0;
  const rs = Number.isFinite(r.recordStoreMs) ? Number(r.recordStoreMs) : 0;
  const ch = Number.isFinite(r.chainMs) ? Number(r.chainMs) : 0;
  return r.totalMs - ih - lh - rs - ch - reg;
}

/**
 * One summary object per canonical tier that has ≥1 ok row.
 * @param {{ ok: boolean, sizeTier?: string }[]} rows
 */
function summarizeE2ByTier(rows) {
  /** @type {ReturnType<typeof stats.quantiles> & { chainCv: number, caseRegCv: number }} */
  const summaries = [];

  for (const tier of payload.E2_TIER_ORDER) {
    const sub = rows.filter((r) => r.ok && r.sizeTier === tier);
    if (sub.length === 0) {
      continue;
    }

    const num = (fn) => sub.map(fn).filter(Number.isFinite);
    const integrity = stats.quantiles(num((r) => r.integrityMs));
    const localHash = stats.quantiles(
      num((r) => (Number.isFinite(r.localHashMs) ? r.localHashMs : 0))
    );
    const recordStore = stats.quantiles(
      num((r) => (Number.isFinite(r.recordStoreMs) ? r.recordStoreMs : 0))
    );
    const chain = stats.quantiles(num((r) => r.chainMs));
    const caseReg = stats.quantiles(
      num((r) => (Number.isFinite(r.caseRegistryMs) ? r.caseRegistryMs : 0))
    );
    const totalR = stats.quantiles(num((r) => r.totalMs));
    const client = stats.quantiles(num((r) => r.clientRoundTripMs));
    const residualVals = sub
      .map((r) => residualUploadMs(r))
      .filter(Number.isFinite);
    const residual =
      residualVals.length > 0
        ? stats.quantiles(residualVals)
        : {
            n: 0,
            min: 0,
            max: 0,
            mean: 0,
            p50: 0,
            p95: 0,
            p99: 0
          };
    const chainVals = num((r) => r.chainMs);
    const crVals = num((r) =>
      Number.isFinite(r.caseRegistryMs) ? r.caseRegistryMs : 0
    );

    summaries.push({
      sizeTier: tier,
      targetBytes: payload.E2_TIER_BYTES[tier],
      n: sub.length,
      integrity,
      localHash,
      recordStore,
      chain,
      caseReg,
      totalR,
      client,
      residual,
      chainCv: stats.cv(chainVals),
      caseRegCv: stats.cv(crVals)
    });
  }

  return summaries;
}

/**
 * Pearson r between tier targetBytes and mean local pre-chain work (integrityMs + localHashMs).
 * @param {ReturnType<summarizeE2ByTier>} summaries
 */
function pearsonIntegrityVsTargetBytes(summaries) {
  if (summaries.length < 3) {
    return NaN;
  }
  const xs = summaries.map((s) => s.targetBytes);
  const ys = summaries.map((s) => s.integrity.mean + s.localHash.mean);
  return stats.pearsonR(xs, ys);
}

/**
 * @param {ReturnType<summarizeE2ByTier>} summaries
 */
/** CV is unstable when the stage mean is small (std/mean blows up); only gate when mean is material. */
const E2_CHAIN_CV_MIN_MEAN_MS = 200;
const E2_CASEREG_CV_MIN_MEAN_MS = 300;

function verifyE2CsvGates(summaries, rIntegrity) {
  const fails = [];
  for (const s of summaries) {
    if (s.chain.mean >= E2_CHAIN_CV_MIN_MEAN_MS) {
      if (!Number.isFinite(s.chainCv) || !(s.chainCv < 0.3)) {
        fails.push(`sizeTier=${s.sizeTier} chainMs_cv=${s.chainCv}`);
      }
    }
    if (s.caseReg.mean >= E2_CASEREG_CV_MIN_MEAN_MS) {
      if (!Number.isFinite(s.caseRegCv) || !(s.caseRegCv < 0.3)) {
        fails.push(`sizeTier=${s.sizeTier} caseRegistryMs_cv=${s.caseRegCv}`);
      }
    }
  }
  if (!Number.isFinite(rIntegrity) || rIntegrity < 0.9) {
    fails.push(`integrityMs vs targetBytes Pearson r=${rIntegrity} (need >= 0.9)`);
  }
  return { ok: fails.length === 0, fails };
}

function formatE2CsvHeader() {
  return [
    'sizeTier',
    'targetBytes',
    'n_ok',
    'integrityMs_mean',
    'integrityMs_p50',
    'integrityMs_p95',
    'localHashMs_mean',
    'localHashMs_p50',
    'localHashMs_p95',
    'recordStoreMs_mean',
    'recordStoreMs_p50',
    'recordStoreMs_p95',
    'chainMs_mean',
    'chainMs_p50',
    'chainMs_p95',
    'caseRegistryMs_mean',
    'caseRegistryMs_p50',
    'caseRegistryMs_p95',
    'residualMs_mean',
    'residualMs_p50',
    'residualMs_p95',
    'totalMs_mean',
    'totalMs_p50',
    'totalMs_p95',
    'clientRoundTripMs_mean',
    'clientRoundTripMs_p50',
    'clientRoundTripMs_p95',
    'chainMs_cv',
    'caseRegistryMs_cv'
  ].join(',');
}

function formatE2SummaryLine(summaries, rIntegrity, gateResult) {
  const parts = [
    'tag=summary',
    `tiers=${summaries.map((s) => s.sizeTier).join('|')}`,
    `integrity_vs_targetBytes_pearson_r=${rIntegrity}`,
    `gate_all_ok=${gateResult.ok ? 1 : 0}`
  ];
  if (!gateResult.ok && gateResult.fails && gateResult.fails.length) {
    parts.push(`fails=${gateResult.fails.join(';')}`);
  }
  return `# ${parts.join(',')}`;
}

/**
 * @param {{ ok: boolean }[]} logicalRows
 * @param {{ includeHeader?: boolean }} opts
 */
function buildE2CsvLines(logicalRows, { includeHeader = true } = {}) {
  const summaries = summarizeE2ByTier(logicalRows);
  const rIntegrity = pearsonIntegrityVsTargetBytes(summaries);
  const gateResult = verifyE2CsvGates(summaries, rIntegrity);
  const legacyTiming =
    logicalRows.length > 0 &&
    logicalRows[0].localHashMs == null &&
    logicalRows[0].recordStoreMs == null;
  const lines = [];
  if (includeHeader) {
    lines.push(formatE2CsvHeader());
  }
  for (const s of summaries) {
    lines.push(
      [
        s.sizeTier,
        s.targetBytes,
        s.n,
        s.integrity.mean.toFixed(4),
        s.integrity.p50.toFixed(4),
        s.integrity.p95.toFixed(4),
        s.localHash.mean.toFixed(4),
        s.localHash.p50.toFixed(4),
        s.localHash.p95.toFixed(4),
        s.recordStore.mean.toFixed(4),
        s.recordStore.p50.toFixed(4),
        s.recordStore.p95.toFixed(4),
        s.chain.mean.toFixed(4),
        s.chain.p50.toFixed(4),
        s.chain.p95.toFixed(4),
        s.caseReg.mean.toFixed(4),
        s.caseReg.p50.toFixed(4),
        s.caseReg.p95.toFixed(4),
        s.residual.mean.toFixed(4),
        s.residual.p50.toFixed(4),
        s.residual.p95.toFixed(4),
        s.totalR.mean.toFixed(4),
        s.totalR.p50.toFixed(4),
        s.totalR.p95.toFixed(4),
        s.client.mean.toFixed(4),
        s.client.p50.toFixed(4),
        s.client.p95.toFixed(4),
        s.chainCv.toFixed(6),
        s.caseRegCv.toFixed(6)
      ].join(',')
    );
  }
  lines.push(formatE2SummaryLine(summaries, rIntegrity, gateResult));
  return {
    lines,
    summaries,
    rIntegrity,
    gates: gateResult,
    legacyTiming
  };
}

/**
 * @param {ReturnType<summarizeE2ByTier>} summaries
 */
function formatE2LineVisualization(summaries) {
  const maxLocalWork = Math.max(
    ...summaries.map((s) => s.integrity.mean + s.localHash.mean),
    1e-9
  );
  const maxChain = Math.max(
    ...summaries.map((s) => s.chain.mean),
    1e-9
  );
  const out = [];
  for (const s of summaries) {
    const localWork = s.integrity.mean + s.localHash.mean;
    const wl = localWork / maxLocalWork;
    const wc = s.chain.mean / maxChain;
    out.push(
      `${s.sizeTier.padEnd(4)}  chainMs ${vizBar(wc, `${s.chain.mean.toFixed(0)} ms`)}  integrity+localHashMs ${vizBar(wl, `${localWork.toFixed(0)} ms`)}`
    );
  }
  return out;
}

function formatE2ResultsTable(summaries, legacyTiming) {
  const legacyNote = legacyTiming
    ? '\n\n**Legacy JSONL:** rows omit `localHashMs` / `recordStoreMs` (produced before gateway timing split). The `integrityMs` field then bundled verify + hash prep + record-store write; `residualMs` is still meaningful. Re-run `npm run perf:e2:full` after upgrading the gateway to populate the split fields.'
    : '';
  const fieldHelp = legacyTiming
    ? '**Timing shape (legacy JSONL):** `integrityMs` in each row combines verify + `computeIndexHash` / `computeRecordHash` + `recordStore.save` (not split). `chainMs` is still CRUD insert RTT only; `residualMs` = `totalMs` minus the labelled fields that exist in the row. Compare E1 (~50 KB) to E2 **10K / 100K** tiers.'
    : 'Gateway fields: `integrityMs` = aggregate-hash verify only; `localHashMs` = index/record hash prep; `recordStoreMs` = write private record store; `chainMs` = CRUD `insertRecord` round-trip (hash-sized); `residualMs` = remainder of `totalMs` (registry/CRUD reconcile, block timestamp lookup, rounding). Compare E1 (~50 KB) to E2 **10K / 100K** tiers for comparable local payload size.';
  const rows = summaries.map(
    (s) =>
      `| ${s.sizeTier} | ${s.targetBytes} | ${s.n} | ${s.integrity.mean.toFixed(2)} | ${s.localHash.mean.toFixed(2)} | ${s.recordStore.mean.toFixed(2)} | ${s.chain.mean.toFixed(2)} | ${s.caseReg.mean.toFixed(2)} | ${s.residual.mean.toFixed(2)} | ${s.totalR.mean.toFixed(2)} | ${s.chainCv.toFixed(3)} | ${s.caseRegCv.toFixed(3)} |`
  );
  return `
**Table E2.1: Per-tier latency (successful uploads).**

${fieldHelp}

| sizeTier | targetBytes (B) | n | integrity mean | localHash mean | recordStore mean | chain mean | caseReg mean | residual mean | total mean | chainMs_cv | caseRegistryMs_cv |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
${legacyNote}
`.trim();
}

function formatE2KeyObservations(summaries, rIntegrity) {
  let maxGatedCv = 0;
  for (const s of summaries) {
    if (s.chain.mean >= E2_CHAIN_CV_MIN_MEAN_MS) {
      maxGatedCv = Math.max(maxGatedCv, s.chainCv);
    }
    if (s.caseReg.mean >= E2_CASEREG_CV_MIN_MEAN_MS) {
      maxGatedCv = Math.max(maxGatedCv, s.caseRegCv);
    }
  }
  const localWorkMeans = summaries
    .map((s) => (s.integrity.mean + s.localHash.mean).toFixed(1))
    .join(', ');
  return [
    `Per-tier CV columns are in the CSV. Acceptance: Pearson r ≥ 0.9; CV < 0.30 for chainMs only when chain mean ≥ ${E2_CHAIN_CV_MIN_MEAN_MS} ms, and for caseRegistryMs only when caseReg mean ≥ ${E2_CASEREG_CV_MIN_MEAN_MS} ms (CV is ill-conditioned when the stage mean is small). Max CV among gated checks: ${maxGatedCv.toFixed(3)}.`,
    `Pearson r uses mean (integrityMs + localHashMs) per tier vs targetBytes (E2.5 summary line): ${Number.isFinite(rIntegrity) ? rIntegrity.toFixed(4) : 'n/a'} (need r ≥ 0.9).`,
    `chainMs is only the CRUD insert round-trip (constant-size hashes on-chain); expect high variance from consensus scheduling, not payload bytes. residualMs captures post-label work (reconcile, block timestamp query).`,
    `Mean (integrityMs + localHashMs) by tier: ${localWorkMeans} ms — compare E1 to E2 10K/100K; larger tiers are dominated by localHash + recordStore + integrity, not chainMs.`
  ];
}

/**
 * @param {object} opts
 * @param {boolean} [opts.offline]
 */
function writeE2SizesMarkdownFile(absPath, opts) {
  const { summaries, rIntegrity, offline } = opts;

  let methodLines;
  if (offline) {
    const tierList = summaries.map((s) => s.sizeTier).join(', ');
    const fr = offline.fileRows;
    const pr = offline.parsedRows;
    const mismatch =
      Number.isFinite(fr) && Number.isFinite(pr) && fr !== pr;
    methodLines = [
      '- Offline report from existing JSONL (E2.6); no new uploads.',
      `- JSONL file ${offline.fileBase || 'e2-sizes.jsonl'}: ${fr} non-empty line(s); ${pr} JSON object(s) parsed; ${offline.ok} row(s) with ok=true; tiers with ok rows: ${tierList}.`,
      ...(mismatch
        ? [
            '- **Warning:** parsed JSON count ≠ non-empty line count — inspect the JSONL for invalid or truncated lines.'
          ]
        : []),
      '- Live reproduction: `npm run perf:e2` or `npm run perf:e2:full` (see `api-gateway/scripts/perf/README.md`).',
      '',
      '`npm run perf:e2:csv-from-jsonl` regenerates CSV; `npm run perf:e2:md-from-jsonl` regenerates this file.'
    ];
  } else {
    const {
      isoStart,
      runId,
      tiers,
      itersPerTier,
      jsonlPath,
      jsonlNonEmptyLines,
      logicalRowCount
    } = opts;
    const jsonlLine =
      jsonlPath != null &&
      jsonlNonEmptyLines != null &&
      logicalRowCount != null
        ? `- JSONL ${path.basename(jsonlPath)}: ${jsonlNonEmptyLines} non-empty line(s); expected ${logicalRowCount} for this run.`
        : null;
    methodLines = [
      '- Sequential POST /api/upload per size tier, X-Debug-Timing: 1, contract mode when enabled.',
      `- Tiers (in order): ${tiers.join(', ')}; itersPerTier=${itersPerTier}; payload via genAtBand (±5% UTF-8).`,
      `- runId=${runId}, startedAt=${isoStart}, gateway token reuse (X_AUTH_TOKEN_SINGLE_USE=0).`,
      ...(jsonlLine ? [jsonlLine] : []),
      '',
      `\`npm run perf:e2 -- --tiers ${tiers.join(',')} --iters ${itersPerTier}\``
    ];
  }

  const tbl = formatE2ResultsTable(summaries, Boolean(opts.legacyTiming));
  const vizBlock = formatE2LineVisualization(summaries).join('\n');
  const bullets = formatE2KeyObservations(summaries, rIntegrity);

  writeSevenSectionReport(absPath, {
    titleLine: `# E2 · Case-size scaling`,
    purpose:
      'Answers whether on-chain stages stay stable as caseJson grows (RQ: hash-only on-chain design); compares integrity vs chain cost.',
    methodLines,
    resultTablesMarkdown: tbl,
    vizBlock,
    bullets,
    artifactsLines: [
      '- [Raw JSONL](./E2/e2-sizes.jsonl)',
      '- [Aggregated CSV](./e2-sizes.csv)',
      '- `npm run perf:e2:csv-from-jsonl` (E2.5 offline CSV from JSONL)',
      '- `npm run perf:e2:md-from-jsonl` (E2.6 offline MD from JSONL)'
    ],
    crossrefsLines: [
      '- [Chapter 4.3 performance fields (upload timing)](../../../../Chapter_4_4.3_EN.md)',
      '- Companion: [E1 latency breakdown](./e1-breakdown.md), [E4 impact](./e4-impact.md)'
    ]
  });
}

module.exports = {
  loadE2Jsonl,
  countJsonlNonEmptyLines,
  residualUploadMs,
  summarizeE2ByTier,
  pearsonIntegrityVsTargetBytes,
  verifyE2CsvGates,
  buildE2CsvLines,
  formatE2LineVisualization,
  formatE2ResultsTable,
  writeE2SizesMarkdownFile
};
