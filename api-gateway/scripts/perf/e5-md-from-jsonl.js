'use strict';

/**
 * E5 offline: E5/e5-reads.jsonl + E1 baseline → e5-reads.md
 */

const fs = require('fs');
const path = require('path');

const { loadE5Jsonl, loadE1ClientRoundTrips, buildE5CsvBundle, writeE5ReadsMarkdown } = require('./lib/e5Aggregate');

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
const defaultMd = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e5-reads.md');

function parseArgs(argv) {
  let e5Jsonl = defaultE5Jsonl;
  let e1Jsonl = defaultE1Jsonl;
  let mdPath = defaultMd;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') {
      e5Jsonl = path.resolve(String(argv[++i]));
    } else if (a === '--e1-jsonl') {
      e1Jsonl = path.resolve(String(argv[++i]));
    } else if (a === '--out') {
      mdPath = path.resolve(String(argv[++i]));
    }
  }
  return { e5Jsonl, e1Jsonl, mdPath };
}

function uniqCaseCount(rows) {
  const ids = new Set();
  for (const r of rows) {
    if (r.caseId != null) {
      ids.add(String(r.caseId));
    }
  }
  return ids.size;
}

function main() {
  const args = parseArgs(process.argv);
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

  let runId = '';
  const firstRead = [...rows].find((r) => r.op === 'query' || r.op === 'case-exists');
  if (firstRead && typeof firstRead.runId === 'string') {
    runId = firstRead.runId;
  }

  const corpusGuess = uniqCaseCount(rows.filter((x) => x.caseId));

  writeE5ReadsMarkdown(args.mdPath, {
    jsonlBasename: path.basename(args.e5Jsonl),
    corpusSize: Math.max(1, corpusGuess),
    runId,
    ratioPassQuery: bundle.ratioPassQuery,
    ratioPassExists: bundle.ratioPassExists,
    vizBlock: bundle.vizBlock,
    summaryRows: bundle.summaryRows,
    e1CsvBasename: 'E1/e1-breakdown.jsonl'
  });
  console.log(`[E5] MD written ${args.mdPath}`);
  process.exit(0);
}

main();
