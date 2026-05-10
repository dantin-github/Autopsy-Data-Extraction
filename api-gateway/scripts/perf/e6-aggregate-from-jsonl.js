'use strict';

/**
 * Offline regeneration of E6-sidecar CSV + Markdown from raw JSONLs.
 */

const fs = require('fs');
const path = require('path');

const {
  loadSidecarJsonl,
  buildE6CsvAndInsights,
  writeE6SidecarMarkdown
} = require('./lib/e6SidecarAggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const resultsDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const defaults = {
  crud: path.join(resultsDir, 'E6', 'e6-sidecar.arm-crud.jsonl'),
  registry: path.join(resultsDir, 'E6', 'e6-sidecar.arm-registry.jsonl'),
  csv: path.join(resultsDir, 'e6-crud-vs-registry.csv'),
  md: path.join(resultsDir, 'e6-crud-vs-registry.md')
};

function usage() {
  console.log(`
Offline E6 CSV + Markdown from two JSONLs.

Usage:
  node scripts/perf/e6-aggregate-from-jsonl.js [--crud <jsonl>] [--registry <jsonl>] [--csv <path>] [--md <path>]

Defaults use docs/evidence/perf/results/E6/e6-sidecar.arm-*.jsonl
`);
}

function parseArgs(argv) {
  let crud = defaults.crud;
  let registry = defaults.registry;
  let csv = defaults.csv;
  let md = defaults.md;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--crud') {
      crud = path.resolve(argv[++i]);
    } else if (a === '--registry') {
      registry = path.resolve(argv[++i]);
    } else if (a === '--csv') {
      csv = path.resolve(argv[++i]);
    } else if (a === '--md') {
      md = path.resolve(argv[++i]);
    }
  }
  return { help: false, crud, registry, csv, md };
}

function deriveRunIdFromRows(rows) {
  const r = rows.find((x) => x.runId != null && String(x.runId).trim() !== '');
  return r ? String(r.runId) : 'unknown-runId';
}

function deriveStores(rows) {
  const r = rows.find((x) => x.recordStorePath != null);
  return r && r.recordStorePath ? String(r.recordStorePath) : '(see JSONL)';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }

  const crudRows = loadSidecarJsonl(args.crud);
  const regRows = loadSidecarJsonl(args.registry);
  const rid = deriveRunIdFromRows(crudRows) !== 'unknown-runId' ? deriveRunIdFromRows(crudRows) : deriveRunIdFromRows(regRows);

  const insights = buildE6CsvAndInsights(crudRows, regRows, rid);
  fs.mkdirSync(path.dirname(args.csv), { recursive: true });
  fs.writeFileSync(args.csv, `${insights.lines.join('\n')}\n`, 'utf8');

  writeE6SidecarMarkdown(args.md, {
    crudJsonl: args.crud,
    registryJsonl: args.registry,
    csvPath: args.csv,
    runId: rid,
    crudStore: deriveStores(crudRows),
    registryStore: deriveStores(regRows),
    insights
  });
  console.log(`[E6 offline] csv=${args.csv}`);
  console.log(`[E6 offline] md =${args.md}`);
}

main();
