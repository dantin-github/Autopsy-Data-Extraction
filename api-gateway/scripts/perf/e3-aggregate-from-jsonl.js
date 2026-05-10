'use strict';

/**
 * E3.4 offline: docs/evidence/perf/results/E3/e3-concurrency.jsonl → e3-concurrency.csv
 */

const fs = require('fs');
const path = require('path');

const {
  loadE3Jsonl,
  buildE3CsvArtifacts,
  csvHeaderLine,
  DEFAULT_LEVEL_ORDER,
  patchE3SummaryRollup
} = require('./lib/e3Aggregate');

const workspaceRoot = path.join(__dirname, '..', '..', '..');
const defaultJsonl = path.join(
  workspaceRoot,
  'docs',
  'evidence',
  'perf',
  'results',
  'E3',
  'e3-concurrency.jsonl'
);
const defaultCsv = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'e3-concurrency.csv');
const defaultSummary = path.join(workspaceRoot, 'docs', 'evidence', 'perf', 'results', 'summary.md');

function usage() {
  console.log(`
E3.4 CSV from JSONL

Usage:
  npm run perf:e3:csv-from-jsonl
  node scripts/perf/e3-aggregate-from-jsonl.js [options]

Options:
  --in <file>                 Input JSONL
  --out <file>                Output CSV
  --verify                    Exit 38 when any tier errorRate > 0.5%
  --gates-e33-offline        Require ≥30 rows per canonical tier (${DEFAULT_LEVEL_ORDER.join(', ')})
  --no-rollup                 Do not rewrite summary.md E3 rollup block (use for E3b and ad-hoc CSV paths)
`);
}

function parseArgs(argv) {
  let inPath = defaultJsonl;
  let outPath = defaultCsv;
  let verify = false;
  let gatesE33Offline = false;
  let noRollup = false;

  for (let i = 2; i < argv.length; i += 1) {
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
    } else if (a === '--gates-e33-offline') {
      gatesE33Offline = true;
    } else if (a === '--no-rollup') {
      noRollup = true;
    } else if (a) {
      throw new Error(`Unknown arg ${a}`);
    }
  }

  const wantVerify = Boolean(verify || gatesE33Offline);
  return {
    help: false,
    inPath,
    outPath,
    verify,
    gatesE33Offline,
    wantVerify,
    noRollup
  };
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

  const parsed = loadE3Jsonl(args.inPath).filter((r) => !r.dry);

  const art = buildE3CsvArtifacts(parsed, {
    levelOrder: DEFAULT_LEVEL_ORDER,
    maxErrorRate: args.wantVerify ? 0.005 : undefined,
    minRowsPerTier: args.gatesE33Offline ? 30 : undefined
  });

  if (art.summaries.length === 0) {
    console.error('E3.4: no aggregate rows (missing non-dry data or unrecognized levels)');
    process.exit(2);
    return;
  }

  const linesOut = [csvHeaderLine(), ...art.lines, art.summaryLine];

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${linesOut.join('\n')}\n`, 'utf8');

  console.log(
    `[E3.4] csv written=${args.outPath} tiers=${art.summaries.length} kneeLevel=${Number.isFinite(art.knee.kneeLevel) ? art.knee.kneeLevel : 'n/a'}`
  );

  if (!args.noRollup) {
    const kL = Number.isFinite(art.knee.kneeLevel) ? String(art.knee.kneeLevel) : 'n/a';
    const kT = Number.isFinite(art.knee.kneeTps) ? art.knee.kneeTps.toFixed(4) : 'n/a';
    const sentence =
      `Saturation knee at concurrency level=${kL}, plateau TPS≈${kT} (E3.5 plateau, ΔTPS<10%). Machine tag ${art.summaryLine.trim()}`;
    patchE3SummaryRollup(defaultSummary, sentence);
    console.log(`[E3.5] rollup patched: ${defaultSummary}`);
  }

  if (args.wantVerify && !art.verifyOk) {
    console.error(`[E3.4] verify FAILED:\n${art.verifyMsgs.join('\n')}`);
    process.exit(38);
    return;
  }

  process.exit(0);
}

main();
