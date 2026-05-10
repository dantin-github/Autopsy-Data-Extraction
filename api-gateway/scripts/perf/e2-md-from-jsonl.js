'use strict';

/**
 * E2.6 offline: results/E2/e2-sizes.jsonl → results/e2-sizes.md
 *
 * Usage (from api-gateway):
 *   npm run perf:e2:md-from-jsonl
 */

const fs = require('fs');
const path = require('path');

const { loadE2Jsonl, buildE2CsvLines, writeE2SizesMarkdownFile, countJsonlNonEmptyLines } = require('./lib/e2Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultJsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E2',
  'e2-sizes.jsonl'
);
const defaultMd = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e2-sizes.md');

function usage() {
  console.log(`
E2.6 Markdown from JSONL (offline report)

Usage:
  npm run perf:e2:md-from-jsonl
  node scripts/perf/e2-md-from-jsonl.js [--in <jsonl>] [--out <md>]
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

  const rows = loadE2Jsonl(args.inPath);
  const okRows = rows.filter((r) => r.ok);
  if (okRows.length === 0) {
    console.error('E2.6: no successful rows in JSONL');
    process.exit(2);
    return;
  }

  const { summaries, rIntegrity, legacyTiming } = buildE2CsvLines(rows, { includeHeader: false });
  if (summaries.length === 0) {
    console.error('E2.6: could not summarize by tier (no ok rows per tier?)');
    process.exit(2);
    return;
  }

  const fileRows = countJsonlNonEmptyLines(args.inPath);

  writeE2SizesMarkdownFile(args.outPath, {
    summaries,
    rIntegrity,
    offline: {
      fileBase: path.basename(args.inPath),
      fileRows,
      parsedRows: rows.length,
      ok: okRows.length
    },
    legacyTiming
  });

  console.log(
    `E2.6 md written: ${args.outPath} (fileLines=${fileRows}, parsed=${rows.length}, ok=${okRows.length})`
  );
  process.exit(0);
}

main();
