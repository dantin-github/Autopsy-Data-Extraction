'use strict';

/**
 * E2.5 offline: results/E2/e2-sizes.jsonl → results/e2-sizes.csv (+ optional gates).
 *
 * Usage (from api-gateway):
 *   npm run perf:e2:csv-from-jsonl
 *   node scripts/perf/e2-aggregate-from-jsonl.js [--in <jsonl>] [--out <csv>] [--verify]
 */

const fs = require('fs');
const path = require('path');

const { loadE2Jsonl, buildE2CsvLines, formatE2LineVisualization } = require('./lib/e2Aggregate');

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
const defaultCsv = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e2-sizes.csv');

function usage() {
  console.log(`
E2.5 CSV from JSONL (offline stats)

Usage:
  npm run perf:e2:csv-from-jsonl
  node scripts/perf/e2-aggregate-from-jsonl.js [options]

Options:
  --in <file>    Input JSONL (default: docs/evidence/perf/results/E2/e2-sizes.jsonl)
  --out <file>   Output CSV (default: docs/evidence/perf/results/e2-sizes.csv)
  --verify       Exit 37 if E2.5 gates fail (Pearson r >= 0.9; CV < 0.3 when stage mean >= 200/300 ms)
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultCsv;
  let verify = false;
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
    }
  }
  return { help: false, inPath, outPath, verify };
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

  const rows = loadE2Jsonl(args.inPath);
  if (rows.length === 0) {
    console.error('E2.5: JSONL is empty');
    process.exit(2);
    return;
  }

  const { lines, summaries, rIntegrity, gates } = buildE2CsvLines(rows, { includeHeader: true });
  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(
    `E2.5 csv written: ${args.outPath} (detail_rows=${rows.length}, tier_rows=${summaries.length}, lines=${lines.length})`
  );
  console.log(
    `E2.5 Pearson r(mean(integrityMs+localHashMs) vs targetBytes)=${rIntegrity} gate_all_ok=${gates.ok}`
  );
  console.log(formatE2LineVisualization(summaries).join('\n'));
  if (args.verify && !gates.ok) {
    console.error(`[E2.5] gate failures: ${(gates.fails || []).join(' | ')}`);
    process.exit(37);
  }
  process.exit(0);
}

main();
