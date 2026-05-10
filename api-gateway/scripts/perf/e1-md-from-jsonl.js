'use strict';

/**
 * E1.5 offline: docs/evidence/perf/results/E1/e1-breakdown.jsonl → results/e1-breakdown.md
 * (seven-section report, same aggregates as E1.4 CSV summary).
 *
 * Usage (from api-gateway):
 *   npm run perf:e1:md-from-jsonl
 *   node scripts/perf/e1-md-from-jsonl.js [--in <jsonl>] [--out <md>]
 */

const fs = require('fs');
const path = require('path');

const {
  loadE1Jsonl,
  buildE1CsvLines,
  writeE1BreakdownMarkdownFile
} = require('./lib/e1Aggregate');
const { countJsonlNonEmptyLines } = require('./lib/e2Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultJsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E1',
  'e1-breakdown.jsonl'
);
const defaultMd = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e1-breakdown.md');

function usage() {
  console.log(`
E1.5 Markdown from JSONL (offline report)

Usage:
  npm run perf:e1:md-from-jsonl --
  node scripts/perf/e1-md-from-jsonl.js [options]

Options:
  --in <file>    Input JSONL (default: docs/evidence/perf/results/E1/e1-breakdown.jsonl)
  --out <file>   Output Markdown (default: docs/evidence/perf/results/e1-breakdown.md)
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultMd;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--in') {
      inPath = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      outPath = path.resolve(String(argv[++i]));
    }
  }
  return { help: false, inPath, outPath };
}

function main() {
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

  if (!fs.existsSync(args.inPath)) {
    console.error(`Input JSONL not found: ${args.inPath}`);
    process.exit(2);
    return;
  }

  const rows = loadE1Jsonl(args.inPath);
  if (rows.length === 0) {
    console.error('E1.5: JSONL is empty');
    process.exit(2);
    return;
  }

  const okCount = rows.filter((r) => r.ok).length;
  if (okCount === 0) {
    console.error('E1.5: no successful rows in JSONL; cannot build report');
    process.exit(2);
    return;
  }

  const { m } = buildE1CsvLines(rows, {
    iters: rows.length,
    okCount,
    includeHeader: true
  });

  const r0 = rows[0] || {};
  const isoStart = typeof r0.ts === 'string' && r0.ts ? r0.ts : '(offline)';
  const targetBytes =
    Number.isFinite(Number(r0.utf8Approx)) ? Number(r0.utf8Approx) | 0 : 0;
  const sizeHuman =
    targetBytes > 0 ? `${targetBytes}B (approx from first row)` : 'unknown';

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  const fileRows = countJsonlNonEmptyLines(args.inPath);

  writeE1BreakdownMarkdownFile(args.outPath, {
    m,
    logicalRows: rows,
    isoStart,
    recordStorePath: 'n/a (offline)',
    iters: rows.length,
    targetBytes,
    sizeHuman,
    offline: {
      fileBase: path.basename(args.inPath),
      fileRows,
      parsedRows: rows.length,
      rows: rows.length,
      ok: okCount
    }
  });

  console.log(
    `E1.5 md written: ${args.outPath} (fileLines=${fileRows}, parsed=${rows.length}, ok=${okCount})`
  );
  process.exit(0);
}

main();
