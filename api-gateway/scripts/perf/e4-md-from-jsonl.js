'use strict';

/**
 * E4 offline: E4/e4-impact.jsonl → e4-impact.md
 */

const fs = require('fs');
const path = require('path');

const { loadE4Jsonl, buildE4CsvLines, writeE4ImpactMarkdown } = require('./lib/e4Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultJsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E4',
  'e4-impact.jsonl'
);
const defaultMd = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e4-impact.md');

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultMd;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') {
      inPath = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      outPath = path.resolve(String(argv[++i]));
    }
  }
  return { inPath, outPath };
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.inPath)) {
    console.error(`Input not found: ${args.inPath}`);
    process.exit(2);
    return;
  }

  const rows = loadE4Jsonl(args.inPath);
  const nReal = rows.filter((r) => r.variant === 'real').length;
  const nMock = rows.filter((r) => r.variant === 'mock').length;
  const itersGuess = nReal === nMock && nReal > 0 ? nReal : Math.max(nReal, nMock, 100);

  const { triple } = buildE4CsvLines(rows);

  writeE4ImpactMarkdown(args.outPath, {
    triple,
    isoStart: typeof rows[0]?.isoStartRun === 'string' ? rows[0].isoStartRun : '',
    reuseE1: rows.some((r) => r.reusedFromE1 === true),
    iters: itersGuess,
    targetBytes:
      typeof rows[0]?.utf8Approx === 'number' ? Math.round(rows[0].utf8Approx) : 50 * 1024,
    jsonlBasename: path.basename(args.inPath),
    realSourceNote: rows.some((r) => r.reusedFromE1) ? `Offline ingest from reused E1 timings` : '',
    e1ComparePct: undefined
  });

  console.log(`[E4] MD written ${args.outPath}`);
  process.exit(0);
}

main();
