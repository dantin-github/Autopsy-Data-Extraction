'use strict';

/**
 * E4 offline: E4/e4-impact.jsonl → e4-impact.csv
 */

const fs = require('fs');
const path = require('path');

const { loadE4Jsonl, buildE4CsvLines } = require('./lib/e4Aggregate');

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
const defaultCsv = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e4-impact.csv');

function usage() {
  console.log(`
E4 CSV from JSONL

Usage:
  npm run perf:e4:aggregate-from-jsonl

Options:
  --in <file>   Input JSONL
  --out <file>  Output CSV
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultCsv;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help') {
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
    console.error(`Input not found: ${args.inPath}`);
    process.exit(2);
    return;
  }

  const rows = loadE4Jsonl(args.inPath);
  const { lines } = buildE4CsvLines(rows);

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[E4] CSV written ${args.outPath}`);
  process.exit(0);
}

main();
