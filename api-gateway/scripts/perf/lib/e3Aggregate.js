'use strict';

/**
 * E3.4 / E3.6: aggregate concurrency JSONL by level → CSV, saturation heuristic, Markdown.
 */

const fs = require('fs');
const path = require('path');

const stats = require('./stats');
const { vizBar, writeSevenSectionReport } = require('./reportMd');

/** @param {string} jsonlPath */
function loadE3Jsonl(jsonlPath) {
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
      throw new Error(`E3 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

function countJsonlNonEmptyLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return raw.split('\n').filter((l) => l.trim() !== '').length;
}

const DEFAULT_LEVEL_ORDER = [1, 2, 4, 8, 16];

function summarizeE3ByLevel(rows, levelOrder = DEFAULT_LEVEL_ORDER) {
  /** @typedef {{ level:number, total:number, ok:number, tierWallMs:number, tps:number, errorRate:number, totalMs:ReturnType<typeof stats.quantiles>, client:ReturnType<typeof stats.quantiles>, status:string }} RowSummary */

  /** @type {RowSummary[]} */
  const out = [];

  for (const lvl of levelOrder) {
    const slice = rows.filter((r) => Number(r.level) === lvl && !r.dry);
    if (slice.length === 0) {
      continue;
    }
    const total = slice.length;
    const okRows = slice.filter((r) => r.ok === true && r.httpStatus === 200);
    const ok = okRows.length;
    const errs = total - ok;
    const wmAll = slice.map((r) => Number(r.tierWallMs)).filter(Number.isFinite);
    const tierWallMs = wmAll.length ? wmAll.reduce((a, b) => Math.max(a, b)) : NaN;

    const tps = tierWallMs > 0 ? (ok / tierWallMs) * 1000 : 0;
    const errorRate = total > 0 ? errs / total : 0;
    let status = 'ok';
    if (errorRate > 0.005) {
      status = 'degraded';
    }

    const numTm = okRows.map((r) => r.totalMs).filter(Number.isFinite);
    const numCl = okRows.map((r) => r.clientRoundTripMs).filter(Number.isFinite);

    /** @returns {typeof stats.quantiles extends infer R ? R : never} */
    function qOf(arr) {
      return arr.length === 0 ? emptyQ() : stats.quantiles(arr);
    }

    const qTotal = /** @type {ReturnType<typeof stats.quantiles>} */ (qOf(numTm));
    const qClient = /** @type {ReturnType<typeof stats.quantiles>} */ (qOf(numCl));

    out.push({
      level: lvl,
      total,
      ok,
      tierWallMs,
      tps,
      errorRate,
      totalMs: qTotal,
      client: qClient,
      status
    });
  }
  return out;
}

function emptyQ() {
  return {
    n: 0,
    min: NaN,
    max: NaN,
    mean: NaN,
    p50: NaN,
    p95: NaN,
    p99: NaN
  };
}

/**
 * Relative TPS gain vs previous concurrency step; first higher level where gain < 10%.
 * @param {{ level:number,tps:number}[]} summariesAsc sorted by level ascending
 */
function saturationKneeFromSummaries(summariesAsc) {
  if (summariesAsc.length === 0) {
    return {
      kneeLevel: NaN,
      kneeTps: NaN,
      relGainsPct: [],
      note: 'no-rows'
    };
  }
  const relGainsPct = [];
  for (let k = 1; k < summariesAsc.length; k += 1) {
    const prev = summariesAsc[k - 1].tps;
    const cur = summariesAsc[k].tps;
    const rel = prev > 1e-9 ? ((cur - prev) / prev) * 100 : cur > prev ? 100 : -100;
    relGainsPct.push(rel);
  }
  for (let k = 1; k < summariesAsc.length; k += 1) {
    const rel = relGainsPct[k - 1];
    if (rel < 10) {
      return {
        kneeLevel: summariesAsc[k].level,
        kneeTps: summariesAsc[k].tps,
        relGainsPct,
        note: 'first-rel-gain-under-10pct'
      };
    }
  }
  const last = summariesAsc[summariesAsc.length - 1];
  return {
    kneeLevel: last.level,
    kneeTps: last.tps,
    relGainsPct,
    note: 'no-knee-found-use-max-level'
  };
}

/** Plan E3.4: per-level CSV incl. client round-trip quantiles through p99 */
function csvHeaderLine() {
  return [
    'level',
    'tps',
    'errorRate',
    'totalMs_p50',
    'totalMs_p95',
    'totalMs_p99',
    'clientRt_p50',
    'clientRt_p95',
    'clientRt_p99'
  ].join(',');
}

/**
 * @typedef {{level:number,tps:number,errorRate:number,totalMs:any, client:any}} SumRow
 */

/**
 * @param {SumRow[]} sums
 */
function summariesToCsvBodyLines(sums) {
  return sums.map((s) =>
    [
      s.level,
      s.tps.toFixed(6),
      s.errorRate.toFixed(6),
      nf(s.totalMs.p50),
      nf(s.totalMs.p95),
      nf(s.totalMs.p99),
      nf(s.client.p50),
      nf(s.client.p95),
      nf(s.client.p99)
    ].join(',')
  );
}

/** @param {number} x */
function nf(x) {
  return Number.isFinite(x) ? Number(x).toFixed(3) : 'nan';
}

/**
 * @typedef {{ summaries: SumRow[], summaryLine:string, knee:any, verifyOk:boolean, verifyMsgs:string[] }} Artifact
 */

/** @returns {Artifact} */
function buildE3CsvArtifacts(rows, options = {}) {
  const levels =
    Array.isArray(options.levelOrder) && options.levelOrder.length
      ? options.levelOrder.slice()
      : DEFAULT_LEVEL_ORDER;
  const summaries = summarizeE3ByLevel(rows, levels);
  const knee = saturationKneeFromSummaries(summaries);
  const lines = summariesToCsvBodyLines(summaries);
  const degraded = summaries.filter((s) => s.status === 'degraded');

  let summaryTail = `# tag=summary kneeLevel=${Number.isFinite(knee.kneeLevel) ? knee.kneeLevel : 'n/a'} kneeTps=${
    Number.isFinite(knee.kneeTps) ? knee.kneeTps.toFixed(4) : 'n/a'
  } kneeNote=${knee.note}`;
  if (degraded.length) {
    summaryTail += ` degradedLevels=${degraded.map((d) => d.level).join(';')}`;
  }

  /** @type {string[]} */
  const verifyMsgs = [];
  let verifyOk = true;
  if (options.minRowsPerTier != null) {
    for (const s of summaries) {
      if (s.total < options.minRowsPerTier) {
        verifyMsgs.push(`level ${s.level}: observations ${s.total} < ${options.minRowsPerTier}`);
        verifyOk = false;
      }
    }
  }
  if (options.maxErrorRate != null) {
    for (const s of summaries) {
      if (s.errorRate > options.maxErrorRate) {
        verifyMsgs.push(`level ${s.level}: errorRate ${s.errorRate} exceeds ${options.maxErrorRate}`);
        verifyOk = false;
      }
    }
  }

  return {
    summaries,
    knee,
    lines,
    summaryLine: summaryTail,
    verifyOk,
    verifyMsgs
  };
}

/**
 * @param {{ level:number,tps:number,totalMs:any }[]} summariesAsc
 * @param {number} kneeLevel
 */
function formatE3TpsVisualization(summariesAsc, kneeLevel) {
  const maxT = Math.max(1e-9, ...summariesAsc.map((s) => s.tps));
  const linesOut = [];
  for (const s of summariesAsc) {
    const w = s.tps / maxT;
    const p99lbl =
      Number.isFinite(s.totalMs.p99) && s.totalMs.n > 0
        ? ` p99=${Number(s.totalMs.p99).toFixed(0)}`
        : '';
    const satu = kneeLevel === s.level ? ' ← saturation' : '';
    const lbl = `${s.tps.toFixed(2)} tps${p99lbl}${satu}`;
    const barPack = vizBar(w, lbl, 20);
    const line = `level=${s.level}  ${barPack}`;
    linesOut.push(line.length > 80 ? line.slice(0, 80) : line);
  }
  return linesOut.join('\n');
}

/**
 * @typedef {{ degradedNote?: string, summariesAsc:any[], knee:any, isoStart:string, durationMs:number, targetBytes:number, sizeHuman:string, jsonlBasename:string, fileRows:number, parsedRows:number, okUploadRows:number}} MdOpts
 */

/**
 * @param {string} absPath
 * @param {MdOpts} opts
 */
function writeE3MarkdownFile(absPath, opts) {
  const {
    summariesAsc,
    knee,
    isoStart = '',
    durationMs,
    targetBytes,
    sizeHuman,
    jsonlBasename,
    fileRows,
    parsedRows,
    okUploadRows,
    degradedNote = '',
    titleLine: titleLineOpt,
    purpose: purposeOpt,
    methodLines: methodLinesOpt,
    artifactsLines: artifactsLinesOpt
  } = opts;

  const tableHdr =
    '| level | TPS (ok/s wall) | errorRate | totalMs p50 | totalMs p95 | totalMs p99 | clientRT p50 | clientRT p95 | clientRT p99 | tierWallMs |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';

  const tableRows = summariesAsc.map((s) => {
    return `| ${s.level} | ${s.tps.toFixed(4)} | ${s.errorRate.toFixed(6)} | ${nf(
      s.totalMs.p50
    )} | ${nf(s.totalMs.p95)} | ${nf(s.totalMs.p99)} | ${nf(s.client.p50)} | ${nf(
      s.client.p95
    )} | ${nf(s.client.p99)} | ${nf(s.tierWallMs)} |`;
  });

  const viz = formatE3TpsVisualization(summariesAsc, knee.kneeLevel);

  /** @type {string[]} */
  const bullets = [];
  const kneeT =
    knee.kneeLevel != null && Number.isFinite(knee.kneeTps)
      ? `level=${knee.kneeLevel} with TPS≈${knee.kneeTps.toFixed(2)}`
      : '(insufficient tiers for knee heuristic)';
  bullets.push(
    `Saturation is marked at concurrency ${kneeT} measured as the first tier where relative TPS gain versus the immediately lower concurrency falls below 10% (E3.5 plateau, ΔTPS<10%).`
  );
  bullets.push(
    `FISCO BCOS publishes higher single-node TPS figures for stripped transaction workloads; the observed plateau here mixes gateway processing, signatures, and full upload responses (consult FISCO BCOS performance documentation versus this REST+contract workload) (E3.5 cross-ref, documented TPS).`
  );
  const peakTps = summariesAsc.length ? Math.max(...summariesAsc.map((z) => z.tps)) : NaN;
  if (Number.isFinite(peakTps)) {
    bullets.push(`Maximum TPS≈${peakTps.toFixed(4)} among tested concurrency levels (E3.4 per-row, tps col).`);
  }
  bullets.push(
    `Evidence (${jsonlBasename}): ${fileRows} non-empty JSONL line(s); parsed objects ${parsedRows}; successful uploads counted ${okUploadRows} across ${summariesAsc.length} concurrency level aggregate(s). (E3.4 offline CSV ingest, counts)`
  );

  const titleLine =
    titleLineOpt != null && String(titleLineOpt).trim() !== ''
      ? titleLineOpt
      : '# E3 · Concurrency throughput';
  const purpose =
    purposeOpt != null && String(purposeOpt).trim() !== ''
      ? purposeOpt
      : 'Maps saturation and tail latency as concurrent uploads increase (RQ 2.1 / throughput vs dissertation Section 5.4 examiner-visible pacing).';

  const defaultMethodLines = [
    `Contract-mode POST /api/upload with ${sizeHuman} caseJson (~${targetBytes} UTF-8 bytes); X-Debug-Timing enabled.`,
    `Each tier repeats lib/stats.js runUntil wall clock spans ${durationMs} ms.`,
    String(isoStart || '').trim() !== ''
      ? `Coordinator wall-clock start UTC: ${isoStart}.`
      : '',
    degradeLine(degradedNote),
    `Canonical JSONL: ${jsonlBasename}; non-empty lines=${fileRows}, parsed=${parsedRows}, ok rows=${okUploadRows}.`,
    `Offline CSV: npm run perf:e3:csv-from-jsonl`
  ].filter((x) => x !== '');
  const methodLines =
    Array.isArray(methodLinesOpt) && methodLinesOpt.length > 0 ? methodLinesOpt : defaultMethodLines;

  const defaultArtifactsLines = [
    `- [Raw JSONL](./E3/${jsonlBasename})`,
    `- [Aggregated CSV](./e3-concurrency.csv)`,
    '- `npm run perf:e3:full` · `npm run perf:e3:csv-from-jsonl` · `npm run perf:e3:md-from-jsonl`'
  ];
  const artifactsLines =
    Array.isArray(artifactsLinesOpt) && artifactsLinesOpt.length > 0
      ? artifactsLinesOpt
      : defaultArtifactsLines;

  writeSevenSectionReport(absPath, {
    titleLine,
    purpose,
    methodLines,
    resultTablesMarkdown: `**Table E3.1: Throughput and latency by concurrency level**\n\n${tableHdr}${tableRows.join('\n')}`,
    vizBlock: viz,
    bullets,
    artifactsLines,
    crossrefsLines: [
      '- [E1 latency breakdown](./e1-breakdown.md)',
      '- [Chapter 4.3 performance narrative](../../../../Chapter_4_4.3_EN.md)'
    ]
  });
}

/** @param {string} degradedNote */
function degradeLine(degradedNote) {
  const t = String(degradedNote || '').trim();
  return t !== '' ? t : '';
}

const E3_SUMMARY_START = '<!-- E3-SUMMARY-START -->';
const E3_SUMMARY_END = '<!-- E3-SUMMARY-END -->';

/**
 * Rewrite E3 rollup sentence in perf results summary (plan E3.5).
 * @param {string} summaryAbsPath
 * @param {string} sentence English single paragraph / line
 */
function patchE3SummaryRollup(summaryAbsPath, sentence) {
  const line = sentence.trimEnd();
  const block = `\n${E3_SUMMARY_START}\n${line}\n${E3_SUMMARY_END}\n`;

  fs.mkdirSync(path.dirname(summaryAbsPath), { recursive: true });
  let raw = '';
  if (fs.existsSync(summaryAbsPath)) {
    raw = fs.readFileSync(summaryAbsPath, 'utf8');
  }

  let next;
  if (raw.includes(E3_SUMMARY_START) && raw.includes(E3_SUMMARY_END)) {
    const re = /\n<!-- E3-SUMMARY-START -->[\s\S]*?<!-- E3-SUMMARY-END -->\n?/;
    next = raw.replace(re, `\n${E3_SUMMARY_START}\n${line}\n${E3_SUMMARY_END}\n`);
    if (!next.includes(E3_SUMMARY_START)) {
      throw new Error('E3 rollup replacement failed unexpectedly');
    }
  } else {
    next = `${raw.trimEnd()}\n\n## E3 throughput${block}`;
  }

  fs.writeFileSync(summaryAbsPath, `${next.trimEnd()}\n`, 'utf8');
}

module.exports = {
  DEFAULT_LEVEL_ORDER,
  loadE3Jsonl,
  countJsonlNonEmptyLines,
  summarizeE3ByLevel,
  saturationKneeFromSummaries,
  csvHeaderLine,
  summariesToCsvBodyLines,
  buildE3CsvArtifacts,
  formatE3TpsVisualization,
  writeE3MarkdownFile,
  patchE3SummaryRollup
};