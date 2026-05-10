'use strict';

/**
 * E5 — read-path latency: POST /api/query vs GET /api/case-exists, vs E1 upload RT ref.
 */

const fs = require('fs');
const path = require('path');

const stats = require('./stats');
const { vizBar, writeSevenSectionReport } = require('./reportMd');

function loadE5Jsonl(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  /** @type {object[]} */
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') {
      continue;
    }
    try {
      const row = JSON.parse(t);
      if (row.op === 'query' || row.op === 'case-exists') {
        out.push(row);
      }
    } catch (e) {
      throw new Error(`E5 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

/**
 * Successful E1 uploads: clientRoundTripMs for baseline row.
 */
function loadE1ClientRoundTrips(e1JsonlPath) {
  const raw = fs.readFileSync(e1JsonlPath, 'utf8');
  const vals = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(t);
    } catch {
      continue;
    }
    const exp = String(row.experiment || '').trim();
    const okExp = exp === 'E1' || exp === 'e1';
    if (!okExp || !row.ok || Number(row.httpStatus) !== 200) {
      continue;
    }
    const rt = Number(row.clientRoundTripMs);
    if (Number.isFinite(rt)) {
      vals.push(rt);
    }
  }
  return vals;
}

function quantifyOp(rows, op) {
  const sub = rows.filter(
    (r) =>
      String(r.op) === op &&
      r.ok === true &&
      Number(r.httpStatus) === 200 &&
      Number.isFinite(Number(r.clientRoundTripMs))
  );
  const rtMs = stats.quantiles(sub.map((z) => Number(z.clientRoundTripMs)));
  return { op, count: sub.length, rtt: rtMs };
}

function nf(x) {
  return Number.isFinite(x) ? Number(x).toFixed(4) : 'nan';
}

/**
 * Build 3 CSV body rows (+ header): query, case-exists, e1-upload-ref.
 * @returns {{ lines: string[], ratioPassQuery: boolean, ratioPassExists: boolean, uploadP50: number, vizBlock: string, summaryRows: object[] }}
 */
function buildE5CsvBundle(e5Rows, e1RtValues) {
  if (!e1RtValues.length) {
    throw new Error('E5 aggregate: empty E1 clientRoundTrip baseline');
  }
  const qQuery = quantifyOp(e5Rows, 'query');
  const qExists = quantifyOp(e5Rows, 'case-exists');

  const e1q = stats.quantiles(e1RtValues);
  const uploadP50 = e1q.p50;
  const uploadP95 = e1q.p95;

  const rq =
    Number.isFinite(uploadP50) && Math.abs(uploadP50) > 1e-6
      ? qQuery.rtt.p50 / uploadP50
      : NaN;
  const rex =
    Number.isFinite(uploadP50) && Math.abs(uploadP50) > 1e-6
      ? qExists.rtt.p50 / uploadP50
      : NaN;

  const ratioPassQuery = Number.isFinite(rq) && rq < 0.3;
  const ratioPassExists = Number.isFinite(rex) && rex < 0.3;

  const header =
    'route,clientRoundTripMs_p50,clientRoundTripMs_p95,ratio_to_upload_p50,count_e5_or_e1';

  const lines = [
    header,
    `query,${nf(qQuery.rtt.p50)},${nf(qQuery.rtt.p95)},${nf(rq)},${qQuery.count}`,
    `case-exists,${nf(qExists.rtt.p50)},${nf(qExists.rtt.p95)},${nf(rex)},${qExists.count}`,
    `e1-upload-ref,${nf(uploadP50)},${nf(uploadP95)},1.0000,${e1RtValues.length}`,
    `# tag=summary ratioGate_query=${ratioPassQuery} ratioGate_caseExists=${ratioPassExists}`
  ];

  const maxBar = Math.max(qQuery.rtt.p50 || 0, qExists.rtt.p50 || 0, uploadP50 || 0, 1);
  const pctQ = Number.isFinite(rq) ? rq * 100 : 0;
  const pctX = Number.isFinite(rex) ? rex * 100 : 0;

  /** @type {string[]} */
  const vizLines = [
    vizBar(Math.min(1, qQuery.rtt.p50 / maxBar), `${'query '.padEnd(14)}${nf(qQuery.rtt.p50)} ms (${nf(pctQ)}% of upload ref p50)`),
    vizBar(Math.min(1, qExists.rtt.p50 / maxBar), `${'case-exists '.padEnd(14)}${nf(qExists.rtt.p50)} ms (${nf(pctX)}% of upload ref p50)`),
    vizBar(1, `${'upload (E1) '.padEnd(14)}${nf(uploadP50)} ms (reference p50)`)
  ];

  const summaryRows = [
    { route: 'query', p50: qQuery.rtt.p50, p95: qQuery.rtt.p95, ratio: rq },
    { route: 'case-exists', p50: qExists.rtt.p50, p95: qExists.rtt.p95, ratio: rex },
    { route: 'e1-upload-ref', p50: uploadP50, p95: uploadP95, ratio: 1 }
  ];

  return {
    lines,
    ratioPassQuery,
    ratioPassExists,
    uploadP50,
    uploadP95,
    vizBlock: vizLines.join('\n'),
    summaryRows,
    qQuery,
    qExists
  };
}

/**
 * Seven-section Markdown (Section numbers = dissertation-friendly headings).
 */
function writeE5ReadsMarkdown(mdPath, ctx) {
  const {
    jsonlBasename,
    corpusSize,
    runId,
    ratioPassQuery,
    ratioPassExists,
    vizBlock,
    summaryRows,
    e1CsvBasename
  } = ctx;

  let ratioNote =
    ratioPassQuery && ratioPassExists
      ? 'Both routes meet ratio_to_upload_p50 < 0.3 vs E1 client RT (E5.6).'
      : 'One or both routes exceeded ratio_to_upload_p50 ≥ 0.3; cold chain/cache or host load may explain higher read latency—note in Threats.';
  ratioNote += ' (E5.6 ratio-col, p50)';

  /** @type {string[]} */
  const tableRows = [];
  tableRows.push(
    '| route | clientRoundTripMs p50 | p95 | ratio_to_upload_p50 |',
    '| :--- | :---: | :---: | :---: |'
  );
  for (const r of summaryRows) {
    tableRows.push(
      `| ${r.route} | ${nf(r.p50)} | ${nf(r.p95)} | ${nf(r.ratio)} |`
    );
  }

  const ratioQ = summaryRows[0].ratio;
  const speedup =
    Number.isFinite(Number(ratioQ)) && Number(ratioQ) > 1e-9 ? 1 / Number(ratioQ) : NaN;

  writeSevenSectionReport(mdPath, {
    titleLine: '# E5 — Read paths (/api/query vs /api/case-exists)',
    purpose:
      'Quantifies judge read-path latency (full integrity / registry reconciliation) versus a lightweight registry existence probe, relative to baseline upload round-trip from E1.',
    methodLines: [
      `- Corpus: ${corpusSize} seeded cases (${runId ? `runId=${runId}, ` : ''}prefixed perf-e5-seed-*).`,
      '- Phase A: repeated POST `/api/query` (judge session agent, single login per run).',
      '- Phase B: repeated GET `/api/case-exists/:caseId` with a fresh X-Auth-Token each call (`acquireToken({ refresh: true })`).',
      `- Raw JSONL basename: ${jsonlBasename}; E1 client RT baseline from ${e1CsvBasename} (successful E1 rows).`
    ],
    resultTablesMarkdown: ['**Table E5.1: Client round-trip (ms)**', '', ...tableRows].join('\n'),
    vizBlock,
    bullets: [
      `Query path p50 is ~${nf(speedup)}× faster than E1 upload client RT at the median (ratio_to_upload_p50=${nf(
        ratioQ
      )}; one eth_call class read vs sealer-heavy write path). (E5.6 ratio-col, p50)`,
      `${ratioNote}`,
      'Compared to uploads, `/api/query` traverses integrity + optional registry mirror logic; `/api/case-exists` is a thin probe—expect case-exists p50 ≤ query p50 in healthy nodes.',
      '/api/query uses session cookie; `/api/case-exists` uses OTP token — token mint cost is amortized separately by measuring full client RT per call.'
    ],
    artifactsLines: [
      `- JSONL: docs/evidence/perf/results/E5/${jsonlBasename}`,
      '- CSV: docs/evidence/perf/results/e5-reads.csv',
      '- Reproduce: npm run perf:e5:full; smoke: npm run perf:e5:smoke; offline: npm run perf:e5:aggregate-from-jsonl, npm run perf:e5:md-from-jsonl.'
    ],
    crossrefsLines: [
      '- Registry read on exists path: api-gateway/src/services/caseRegistryTx.js (function getRecordHashOnRegistry).',
      '- Query route: POST /api/query (judge session) — integrity + chain reconciliation.'
    ]
  });
}

module.exports = {
  loadE5Jsonl,
  loadE1ClientRoundTrips,
  buildE5CsvBundle,
  writeE5ReadsMarkdown
};
