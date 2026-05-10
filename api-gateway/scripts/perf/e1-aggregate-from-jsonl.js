'use strict';

/**
 * E1.4 offline: re-aggregate docs/evidence/perf/results/E1/e1-breakdown.jsonl → results/e1-breakdown.csv
 * and print stacked ASCII bars (no gateway / no uploads).
 *
 * Usage (from api-gateway):
 *   npm run perf:e1:csv-from-jsonl
 *   node scripts/perf/e1-aggregate-from-jsonl.js [--in <jsonl>] [--out <csv>] [--verify] [--no-csv-header]
 */

const fs = require('fs');
const path = require('path');

const {
  loadE1Jsonl,
  buildE1CsvLines,
  verifyTotalMsP50Tolerance,
  printE1StackedBarStdout
} = require('./lib/e1Aggregate');

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
const defaultCsv = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e1-breakdown.csv');

function usage() {
  console.log(`
E1.4 CSV from JSONL (offline stats)

Usage:
  npm run perf:e1:csv-from-jsonl --
  node scripts/perf/e1-aggregate-from-jsonl.js [options]

Options:
  --in <file>       Input JSONL (default: docs/evidence/perf/results/E1/e1-breakdown.jsonl)
  --out <file>      Output CSV (default: docs/evidence/perf/results/e1-breakdown.csv)
  --verify          Exit 34 if totalMs_p50 reconciliation delta >= 1 ms
  --no-csv-header   Omit header row (N detail + 1 summary lines)
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultCsv;
  let verify = false;
  let noCsvHeader = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--in') {
      inPath = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      outPath = path.resolve(String(argv[++i]));
    } else if (a === '--verify') {
      verify = true;
    } else if (a === '--no-csv-header') {
      noCsvHeader = true;
    }
  }
  return { help: false, inPath, outPath, verify, noCsvHeader };
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
    console.error('E1.4: JSONL is empty');
    process.exit(2);
    return;
  }

  const okCount = rows.filter((r) => r.ok).length;
  const iters = rows.length;
  const { lines, m } = buildE1CsvLines(rows, {
    iters,
    okCount,
    includeHeader: !args.noCsvHeader
  });

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${lines.join('\n')}\n`, 'utf8');

  const chk = verifyTotalMsP50Tolerance(rows, m);
  console.log(
    `E1.4 csv written: ${args.outPath} (rows=${rows.length}, ok=${okCount}, csv_lines=${lines.length})`
  );
  console.log(
    `E1.4 totalMs_p50 check: direct=${chk.direct} summary_totalMs_p50=${chk.summary} delta_ms=${chk.delta} ok=${chk.ok}`
  );

  printE1StackedBarStdout(m);

  if (args.verify && !chk.ok) {
    process.exit(34);
  }
  process.exit(0);
}

main();
