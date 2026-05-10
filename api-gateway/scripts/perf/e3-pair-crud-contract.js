'use strict';

/**
 * Minimal E3 two-run driver: identical sweep twice, separating
 * CRUD-only upload (CHAIN_MODE=crud → one chain tx per upload: insertRecord) from
 * the contract upload path (CHAIN_MODE=contract → CRUD insert + CaseRegistry unless UPLOAD_SINGLE_CHAIN_TX=1, then Registry only).
 *
 * Precheck before running:
 *   npm run perf:precheck                              (canonical: registry + chain)
 * Optional if your `.env` has no usable CaseRegistry URL but CRUD uploads are valid:
 *   npm run perf:precheck:upload-crud   (same as PERF_PRECHECK_UPLOAD_CRUD_ONLY=1)
 *
 * Usage (from api-gateway root):
 *   node scripts/perf/e3-pair-crud-contract.js --smoke
 *   node scripts/perf/e3-pair-crud-contract.js --gates-e33
 *
 * Forwards CLI args to each `e3-concurrency.js` subprocess. Adds `--no-report` so CSV/MD defaults
 * are not overwritten — aggregate per JSONL, e.g.:
 *   node scripts/perf/e3-aggregate-from-jsonl.js --in ../docs/evidence/perf/results/E3/e3-concurrency-crud.jsonl --out ../docs/evidence/perf/results/e3-concurrency-crud.csv
 */

const { spawnSync } = require('child_process');
const path = require('path');

const apiRoot = path.join(__dirname, '..', '..');
const e3 = path.join(__dirname, 'e3-concurrency.js');
const workspaceRoot = path.join(apiRoot, '..');
const e3pairCrud = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E3',
  'e3-concurrency-crud.jsonl'
);
const e3pairContract = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E3',
  'e3-concurrency-contract.jsonl'
);

const forward = process.argv.slice(2);

if (forward.some((a) => a === '--help' || a === '-h')) {
  console.log(`
E3 pair driver: CRUD vs contract upload paths (same E3 args, two JSONL outputs).

Writes:
  ${path.normalize(e3pairCrud)}
  ${path.normalize(e3pairContract)}

omit --out and --dry
`);
  process.exit(0);
}

if (forward.includes('--dry')) {
  console.error('e3-pair-crud-contract: omit --dry — pair compares live uploads');
  process.exit(2);
}

if (forward.includes('--out')) {
  console.error('e3-pair-crud-contract: omit --out — use the fixed pair filenames above');
  process.exit(2);
}

const baseArgs = [...forward, '--no-report'];

function run(extraEnv, outPath, label) {
  console.log(`\n=== E3 pair · ${label} · JSONL=${path.normalize(outPath)} ===\n`);
  const env = { ...process.env, ...extraEnv };
  const r = spawnSync(process.execPath, [e3, ...baseArgs, '--out', outPath], {
    cwd: apiRoot,
    env,
    stdio: 'inherit'
  });
  const status = r.status !== 0 && r.status !== null ? r.status : 0;
  if (status !== 0) {
    process.exit(status);
  }
}

run(
  {
    CHAIN_MODE: 'crud',
    /** Ensure CaseRegistry branch stays off while CHAIN_MODE=crud (overrides stray .env flags). */
    UPLOAD_USE_CASE_REGISTRY: process.env.PERF_PAIR_CRUD_UPLOAD_USE_CASE_REGISTRY || '0'
  },
  e3pairCrud,
  'CHAIN_MODE=crud (single chain write per upload — insertRecord only)'
);

run(
  {
    CHAIN_MODE: 'contract'
  },
  e3pairContract,
  'CHAIN_MODE=contract (default: insertRecord + Registry; UPLOAD_SINGLE_CHAIN_TX=1: Registry-only one tx)'
);

console.log('\n[E3 pair] done — regenerate CSV/markdown offline with --in pointing at each JSONL.\n');
