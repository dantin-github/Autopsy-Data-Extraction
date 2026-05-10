'use strict';

/**
 * E5 offline: E5/e5-reads.jsonl + E1 baseline → e5-reads.csv
 */

const fs = require('fs');
const path = require('path');

const { loadE5Jsonl, loadE1ClientRoundTrips, buildE5CsvBundle } = require('./lib/e5Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultE5Jsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E5',
  'e5-reads.jsonl'
);
const defaultE1Jsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E1',
  'e1-breakdown.jsonl'
);
const defaultCsv = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e5-reads.csv');

function usage() {
  console.log(`
Usage:
  node scripts/perf/e5-aggregate-from-jsonl.js [--in jsonl] [--e1-jsonl path] [--out csv]

Defaults:
  --in   docs/evidence/perf/results/E5/e5-reads.jsonl
  --e1-jsonl docs/evidence/perf/results/E1/e1-breakdown.jsonl
  --out docs/evidence/perf/results/e5-reads.csv
`);
}

function parseArgs(argv) {
  let e5Jsonl = defaultE5Jsonl;
  let e1Jsonl = defaultE1Jsonl;
  let outPath = defaultCsv;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--in') {
      e5Jsonl = path.resolve(String(argv[++i]));
    } else if (a === '--e1-jsonl') {
      e1Jsonl = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      outPath = path.resolve(String(argv[++i]));
    }
  }
  return { help: false, e5Jsonl, e1Jsonl, outPath };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }

  if (!fs.existsSync(args.e5Jsonl)) {
    console.error(`Missing E5 JSONL: ${args.e5Jsonl}`);
    process.exit(2);
    return;
  }
  if (!fs.existsSync(args.e1Jsonl)) {
    console.error(`Missing E1 JSONL: ${args.e1Jsonl}`);
    process.exit(2);
    return;
  }

  const rows = loadE5Jsonl(args.e5Jsonl);
  const e1Rt = loadE1ClientRoundTrips(args.e1Jsonl);
  const bundle = buildE5CsvBundle(rows, e1Rt);

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${bundle.lines.join('\n')}\n`, 'utf8');
  console.log(`[E5] CSV written ${args.outPath}`);
  process.exit(0);
}

main();
