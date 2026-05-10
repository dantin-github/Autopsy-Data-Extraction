'use strict';

/**
 * E6-sidecar orchestrator: run CRUD arm then registry arm in **separate child Node processes**,
 * then emit CSV + Markdown under docs/evidence/perf/results/.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const apiRoot = path.join(__dirname, '..', '..');
const workspaceRoot = path.join(apiRoot, '..');
const resultsDir = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results');
const e6Dir = path.join(resultsDir, 'E6');
const armScript = path.join(__dirname, 'e6-sidecar-arm.js');

const {
  loadSidecarJsonl,
  buildE6CsvAndInsights,
  writeE6SidecarMarkdown
} = require('./lib/e6SidecarAggregate');

function usage() {
  console.log(`
E6-sidecar orchestrator — CRUD vs CaseRegistry (two processes).

Usage:
  npm run perf:e6 [-- [options]]
  node scripts/perf/e6-crud-vs-registry.js [--smoke | --warmup N] [--measure N] [--size 50KB]

Smoke: warmup=2, measure=8, temp-like short run.

Env: inherits api-gateway/.env; requires live chain + CaseRegistry addr for registry arm.

Outputs (stable names — last writer wins):
  docs/evidence/perf/results/E6/e6-sidecar.arm-crud.jsonl
  docs/evidence/perf/results/E6/e6-sidecar.arm-registry.jsonl
  docs/evidence/perf/results/e6-crud-vs-registry.csv
  docs/evidence/perf/results/e6-crud-vs-registry.md
`);
}

function parseArgs(argv) {
  let smoke = false;
  let warmup = 5;
  let measure = 30;
  let sizeHuman = '50KB';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    if (a === '--smoke') {
      smoke = true;
    } else if (a === '--warmup') {
      warmup = Math.max(0, Number(argv[++i]));
    } else if (a === '--measure') {
      measure = Math.max(1, Number(argv[++i]));
    } else if (a === '--size') {
      sizeHuman = argv[++i];
    }
  }
  if (smoke) {
    warmup = 2;
    measure = 8;
  }
  return { help: false, smoke, warmup, measure, sizeHuman };
}

function runArm({ arm, runId, outJsonl, recordStore, warmup, measure, sizeHuman }) {
  const argv = [
    armScript,
    '--arm',
    arm,
    '--run-id',
    runId,
    '--out',
    outJsonl,
    '--record-store',
    recordStore,
    '--warmup',
    String(warmup),
    '--measure',
    String(measure),
    '--size',
    sizeHuman
  ];
  const proc = spawnSync(process.execPath, argv, {
    cwd: apiRoot,
    env: {
      ...process.env,
      PERF_SIDECAR_RUN_ID: runId
    },
    stdio: 'inherit',
    encoding: 'utf8'
  });
  return { status: proc.status, pid: proc.pid };
}

/** After both JSONLs exist — aggregate + markdown */
function writeReports(runId, crudJsonl, registryJsonl, csvPath, mdPath, stores, pids) {
  const crudRows = loadSidecarJsonl(crudJsonl);
  const regRows = loadSidecarJsonl(registryJsonl);
  const insights = buildE6CsvAndInsights(crudRows, regRows, runId);
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, `${insights.lines.join('\n')}\n`, 'utf8');

  writeE6SidecarMarkdown(mdPath, {
    crudJsonl,
    registryJsonl,
    csvPath,
    runId,
    crudStore: stores.crud,
    registryStore: stores.registry,
    crudPid: pids.crud != null ? String(pids.crud) : '',
    registryPid: pids.registry != null ? String(pids.registry) : '',
    insights
  });
  console.log(`[E6 sidecar] csv=${csvPath}`);
  console.log(`[E6 sidecar] md =${mdPath}`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
    return;
  }

  fs.mkdirSync(e6Dir, { recursive: true });

  let precheckPassed = false;
  const pre = spawnSync(process.execPath, [path.join(apiRoot, 'scripts', 'perf', 'precheck.js')], {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit'
  });
  precheckPassed = pre.status === 0;

  const runId = crypto.randomBytes(8).toString('hex');
  const crudJsonl = path.join(e6Dir, 'e6-sidecar.arm-crud.jsonl');
  const registryJsonl = path.join(e6Dir, 'e6-sidecar.arm-registry.jsonl');
  const crudStore = path.join(e6Dir, `e6-recordstore.arm-crud-${runId}.json`);
  const regStore = path.join(e6Dir, `e6-recordstore.arm-registry-${runId}.json`);
  const csvPath = path.join(resultsDir, 'e6-crud-vs-registry.csv');
  const mdPath = path.join(resultsDir, 'e6-crud-vs-registry.md');

  if (!precheckPassed) {
    console.error('[E6 sidecar] precheck failed — fix env before running uploads.');
    console.error('[E6 sidecar] Continuing only when chain & users configured (exit if not applicable). Use smoke after precheck fixes.');
    process.exit(pre.status ?? 41);
    return;
  }

  console.log(`[E6 sidecar] runId=${runId} warmup=${args.warmup} measure=${args.measure} size=${args.sizeHuman}`);
  fs.writeFileSync(
    path.join(e6Dir, `e6-sidecar-runsheet-${runId}.json`),
    JSON.stringify(
      {
        runId,
        warmup: args.warmup,
        measure: args.measure,
        sizeHuman: args.sizeHuman,
        armCrud: { recordStorePath: crudStore, jsonl: crudJsonl },
        armRegistry: { recordStorePath: regStore, jsonl: registryJsonl },
        createdUtc: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );

  const pidLog = {};

  console.log('[E6 sidecar] --- arm crud ---');
  const rc = runArm({
    arm: 'crud',
    runId,
    outJsonl: crudJsonl,
    recordStore: crudStore,
    warmup: args.warmup,
    measure: args.measure,
    sizeHuman: args.sizeHuman
  });
  pidLog.crud = rc.pid;

  let exitCode = rc.status ?? 1;
  if (exitCode !== 0) {
    console.error(`[E6 sidecar] CRUD arm failed status=${exitCode}`);
    process.exit(exitCode);
    return;
  }

  console.log('[E6 sidecar] --- arm registry ---');
  const rr = runArm({
    arm: 'registry',
    runId,
    outJsonl: registryJsonl,
    recordStore: regStore,
    warmup: args.warmup,
    measure: args.measure,
    sizeHuman: args.sizeHuman
  });
  pidLog.registry = rr.pid;
  exitCode = rr.status ?? 1;

  if (exitCode !== 0) {
    console.error(`[E6 sidecar] registry arm failed status=${exitCode}`);
    process.exit(exitCode);
    return;
  }

  writeReports(runId, crudJsonl, registryJsonl, csvPath, mdPath, { crud: crudStore, registry: regStore }, pidLog);
  fs.writeFileSync(
    path.join(e6Dir, `e6-sidecar-runsheet-${runId}.json`),
    JSON.stringify(
      {
        runId,
        warmup: args.warmup,
        measure: args.measure,
        sizeHuman: args.sizeHuman,
        orchestratorPid: process.pid,
        armCrud: { recordStorePath: crudStore, jsonl: crudJsonl, childPid: pidLog.crud },
        armRegistry: { recordStorePath: regStore, jsonl: registryJsonl, childPid: pidLog.registry },
        derivedCsv: csvPath,
        derivedMd: mdPath,
        completedUtc: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );

  if (args.smoke) {
    console.log('[E6 sidecar smoke] ok');
  }
  process.exit(0);
}

main();
