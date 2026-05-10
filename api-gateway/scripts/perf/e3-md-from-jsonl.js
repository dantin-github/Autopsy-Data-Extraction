'use strict';

/**
 * E3.6 offline: E3 JSONL → docs/evidence/perf/results/e3-concurrency.md
 */

const fs = require('fs');
const path = require('path');

const {
  loadE3Jsonl,
  buildE3CsvArtifacts,
  countJsonlNonEmptyLines,
  writeE3MarkdownFile,
  DEFAULT_LEVEL_ORDER
} = require('./lib/e3Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultJsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E3',
  'e3-concurrency.jsonl'
);
const defaultMd = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e3-concurrency.md');

function usage() {
  console.log(`
E3 Markdown from JSONL

Usage:
  npm run perf:e3:md-from-jsonl
  node scripts/perf/e3-md-from-jsonl.js [--in <jsonl>] [--out <md>] [--e3b] [--arm-note <text>]

  --e3b        E3b report template (artifacts under ./E3b/ in the Markdown links)
  --arm-note   First method bullet when --e3b (English, operator-facing)
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultMd;
  let e3b = false;
  let armNote = '';
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--in') inPath = path.resolve(String(argv[++i]));
    else if (a === '--out') outPath = path.resolve(String(argv[++i]));
    else if (a === '--e3b') e3b = true;
    else if (a === '--arm-note') armNote = String(argv[++i] || '').trim();
  }
  return { help: false, inPath, outPath, e3b, armNote };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }
  if (!fs.existsSync(args.inPath)) {
    console.error(`Input JSONL not found: ${args.inPath}`);
    process.exit(2);
    return;
  }

  const rawRows = loadE3Jsonl(args.inPath);
  const rowsNonDry = rawRows.filter((r) => !r.dry);

  if (rowsNonDry.length === 0) {
    console.error('E3.6: no non-dry rows to summarize');
    process.exit(2);
    return;
  }

  const art = buildE3CsvArtifacts(rowsNonDry, { levelOrder: DEFAULT_LEVEL_ORDER });

  const summariesAsc = art.summaries.slice().sort((a, b) => a.level - b.level);
  if (summariesAsc.length === 0) {
    console.error('E3.6: empty tier aggregates');
    process.exit(2);
    return;
  }

  const degraded = summariesAsc.filter((z) => z.status === 'degraded');
  const degradedNote =
    degraded.length > 0
      ? `Degraded tiers (errorRate>0.5%): levels ${degraded.map((z) => z.level).join(', ')}`
      : '';

  const wmSum = summariesAsc.reduce((acc, z) => acc + Number(z.tierWallMs || 0), 0);
  const durationMsGuess = summariesAsc.length ? Math.round(wmSum / summariesAsc.length) : 0;
  const utf8Guess =
    typeof rowsNonDry[0].utf8Approx === 'number' ? rowsNonDry[0].utf8Approx : NaN;
  const sizeHumanGuess = Number.isFinite(utf8Guess)
    ? `~${(utf8Guess / 1024).toFixed(0)}KB`
    : 'see UTF-8 size in JSONL utf8Approx';
  const targetBytesGuess = Number.isFinite(utf8Guess) ? Math.round(utf8Guess) : 100 * 1024;

  const fileRows = countJsonlNonEmptyLines(args.inPath);
  const baseName = path.basename(args.inPath);
  const csvBaseName = baseName.replace(/\.jsonl$/i, '.csv');

  /** @type {Parameters<typeof writeE3MarkdownFile>[1]} */
  let mdExtras = {};

  if (args.e3b) {
    const armLine =
      args.armNote !== ''
        ? args.armNote
        : 'Single on-chain-write arm (see repository scripts/perf/e3b-single-arms.js).';
    mdExtras = {
      titleLine: '# E3b · Concurrency throughput (single chain-write arm)',
      purpose:
        'Same sampling as canonical E3.3 (--gates-e33: concurrency 1,2,4,8,16 × 60s per tier, 5s pause, 100KB caseJson). One arm varies only chain path: CRUD insertRecord vs CaseRegistry-only upload.',
      methodLines: [
        armLine,
        `POST /api/upload with ${sizeHumanGuess} caseJson (~${targetBytesGuess} UTF-8 bytes); X-Debug-Timing enabled via harness.`,
        `Each tier uses lib/stats.js runForDuration wall clock ≈ ${durationMsGuess} ms per level (see JSONL tierWallMs).`,
        typeof rowsNonDry[0].startTs === 'string' && String(rowsNonDry[0].startTs).trim() !== ''
          ? `First row startTs (approx. coordinator UTC): ${rowsNonDry[0].startTs}.`
          : '',
        degradedNote !== '' ? degradedNote : '',
        `Evidence JSONL: ${baseName}; non-empty lines=${fileRows}, parsed=${rawRows.length}, ok uploads=${rowsNonDry.filter((z) => z.ok === true && z.httpStatus === 200).length}.`,
        'Offline ingest: npm run perf:e3:csv-from-jsonl -- --in <jsonl> --out <csv> --no-rollup'
      ].filter((x) => x !== ''),
      artifactsLines: [
        `- [Raw JSONL](./E3b/${baseName})`,
        `- [Aggregated CSV](./E3b/${csvBaseName})`,
        '- `npm run perf:e3b:single-arms` (full) · `npm run perf:e3b:single-arms:smoke` (short)'
      ]
    };
  }

  writeE3MarkdownFile(args.outPath, {
    summariesAsc,
    knee: art.knee,
    isoStart: typeof rowsNonDry[0].startTs === 'string' ? rowsNonDry[0].startTs : '',
    durationMs: durationMsGuess,
    targetBytes: targetBytesGuess,
    sizeHuman: sizeHumanGuess,
    jsonlBasename: baseName,
    fileRows,
    parsedRows: rawRows.length,
    okUploadRows: rowsNonDry.filter((z) => z.ok === true && z.httpStatus === 200).length,
    degradedNote,
    ...mdExtras
  });

  console.log(`E3.6 md=${args.outPath} fileLines=${fileRows} nonDry=${rowsNonDry.length}`);
  process.exit(0);
}

main();