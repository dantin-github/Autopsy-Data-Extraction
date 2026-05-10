'use strict';

/**
 * E3b — two single chain-write arms matching E3 dual-run sampling.
 *
 * Full (--gates-e33): levels 1,2,4,8,16 × 60s/tier, 5s pause, 100KB caseJson (same as E3.3 / perf:e3:pair).
 * Smoke (--smoke): level=2 × 10s (same as perf:e3:smoke).
 *
 * Outputs (docs/evidence/perf/results/E3b/):
 *   Full:  e3b-crud-upload.{jsonl,csv,md}, e3b-case-registry-upload.{jsonl,csv,md}
 *   Smoke: e3b-crud-smoke.{jsonl,csv,md}, e3b-case-registry-smoke.{jsonl,csv,md}
 *
 * Arm A — CRUD: CHAIN_MODE=crud, UPLOAD_USE_CASE_REGISTRY=0
 * Arm B — CaseRegistry: CHAIN_MODE=contract, UPLOAD_SINGLE_CHAIN_TX=1 (needs CASE_REGISTRY_ADDR; signingPassword via harness / PERF_SIGNING_PASSWORD)
 *
 * From api-gateway root:
 *   npm run perf:e3b:single-arms
 *   npm run perf:e3b:single-arms:smoke
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const apiRoot = path.join(__dirname, '..', '..');
const e3 = path.join(__dirname, 'e3-concurrency.js');
const agg = path.join(__dirname, 'e3-aggregate-from-jsonl.js');
const mdScript = path.join(__dirname, 'e3-md-from-jsonl.js');
const workspaceRoot = path.join(apiRoot, '..');
const e3bDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'E3b');

const argv = process.argv.slice(2);
const smoke = argv.includes('--smoke');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
E3b single-arm driver: CRUD-only vs CaseRegistry-only upload, same E3 sampling.

  --smoke   Short run into *-smoke.* files (no E3.3 row-count gate on aggregate)

Artifacts: ${path.normalize(e3bDir)}
`);
  process.exit(0);
}

fs.mkdirSync(e3bDir, { recursive: true });

const names = smoke
  ? {
      crudBase: 'e3b-crud-smoke',
      regBase: 'e3b-case-registry-smoke'
    }
  : {
      crudBase: 'e3b-crud-upload',
      regBase: 'e3b-case-registry-upload'
    };

function pathsForBase(base) {
  return {
    jsonl: path.join(e3bDir, `${base}.jsonl`),
    csv: path.join(e3bDir, `${base}.csv`),
    md: path.join(e3bDir, `${base}.md`)
  };
}

const crudP = pathsForBase(names.crudBase);
const regP = pathsForBase(names.regBase);

function runNode(scriptPath, args, extraEnv) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: apiRoot,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    stdio: 'inherit'
  });
  if (r.status !== 0 && r.status != null) {
    process.exit(r.status);
  }
}


console.log('\n=== E3b arm A — CRUD (CHAIN_MODE=crud, insertRecord only) ===\n');
runNode(e3, smoke ? ['--smoke', '--out', crudP.jsonl] : ['--gates-e33', '--no-report', '--out', crudP.jsonl], {
  CHAIN_MODE: 'crud',
  UPLOAD_USE_CASE_REGISTRY: '0'
});

console.log('\n=== E3b arm B — CaseRegistry (CHAIN_MODE=contract, UPLOAD_SINGLE_CHAIN_TX=1) ===\n');
runNode(e3, smoke ? ['--smoke', '--out', regP.jsonl] : ['--gates-e33', '--no-report', '--out', regP.jsonl], {
  CHAIN_MODE: 'contract',
  UPLOAD_SINGLE_CHAIN_TX: '1'
});

function postArm(jsonlPath, csvPath, mdPath, armNote) {
  const aggArgs = ['--in', jsonlPath, '--out', csvPath, '--no-rollup'];
  if (!smoke) {
    aggArgs.push('--gates-e33-offline');
  }
  runNode(agg, aggArgs, null);
  runNode(mdScript, ['--in', jsonlPath, '--out', mdPath, '--e3b', '--arm-note', armNote], null);
}

postArm(
  crudP.jsonl,
  crudP.csv,
  crudP.md,
  'Arm A — CRUD only: CHAIN_MODE=crud and UPLOAD_USE_CASE_REGISTRY=0; one CRUD insertRecord transaction per successful upload (same tiers and payload size as E3 dual-arm runs).'
);
postArm(
  regP.jsonl,
  regP.csv,
  regP.md,
  'Arm B — CaseRegistry only: CHAIN_MODE=contract and UPLOAD_SINGLE_CHAIN_TX=1; one CaseRegistry.createRecord transaction per successful upload; no t_case_hash insert on this path.'
);

console.log(`\n[E3b] done — artifacts under ${path.normalize(e3bDir)}\n`);
