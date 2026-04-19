'use strict';

/**
 * S5.1: Deploy CaseRegistry.sol via FISCO Node SDK (same account as CRUD: gateway.pem).
 *
 * Prerequisites:
 *   - conf/fisco-config.json + conf/accounts/gateway.pem (see npm run copy-chain-certs)
 *   - Build artifacts: npm run compile -- contracts/CaseRegistry.sol (or use default --compile)
 *
 * Usage (from api-gateway):
 *   node scripts/deploy-contract.js
 *   node scripts/deploy-contract.js --no-compile          # use existing build/CaseRegistry.{abi,bin}
 *   node scripts/deploy-contract.js --env .env.local       # write address to another file
 *
 * Writes CASE_REGISTRY_ADDR=0x... to .env (or --env path). Does not load Express config.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Configuration, Web3jService } = require('fisco-bcos');

const apiRoot = path.join(__dirname, '..');

function resolveFiscoConfigPath() {
  const raw = process.env.FISCO_CONFIG;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim();
    if (s === '~' || s.startsWith('~/')) {
      return s === '~' ? os.homedir() : path.join(os.homedir(), s.slice(2));
    }
    return path.resolve(process.cwd(), s);
  }
  return path.join(apiRoot, 'conf', 'fisco-config.json');
}

function parseArgs(argv) {
  const out = { compile: true, envFile: path.join(apiRoot, '.env'), force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-compile') {
      out.compile = false;
    } else if (a === '--force') {
      out.force = true;
    } else if (a === '--env' && argv[i + 1]) {
      out.envFile = path.resolve(process.cwd(), argv[++i]);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function upsertEnvVar(filePath, key, value, commentLine) {
  const lineOut = `${key}=${value}`;
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }
  const lines = content.split(/\r?\n/);
  const re = new RegExp(`^${key}\\s*=`);
  let found = false;
  const next = lines.map((line) => {
    if (re.test(line)) {
      found = true;
      return lineOut;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== '') {
      next.push('');
    }
    if (commentLine) {
      next.push(commentLine);
    }
    next.push(lineOut);
  }
  fs.writeFileSync(filePath, `${next.join('\n')}\n`, 'utf8');
}

function receiptStatusOk(receipt) {
  if (!receipt || receipt.status === undefined || receipt.status === null) {
    return true;
  }
  const st = receipt.status;
  const n = typeof st === 'string' ? parseInt(st, 16) : Number(st);
  return n === 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/deploy-contract.js [--no-compile] [--env <file>] [--force]
  --no-compile   Skip solc; require build/CaseRegistry.{abi,bin}
  --env <path>   Write CASE_REGISTRY_ADDR here (default: api-gateway/.env)
  --force        Deploy even if CASE_REGISTRY_ADDR is already set in process.env`);
    process.exit(0);
  }

  const fiscoConfigPath = resolveFiscoConfigPath();
  const cfgDir = path.dirname(fiscoConfigPath);
  const gatewayPemPath = path.join(cfgDir, 'accounts', 'gateway.pem');

  if (!fs.existsSync(fiscoConfigPath)) {
    console.error(`Missing FISCO config: ${fiscoConfigPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(gatewayPemPath)) {
    console.error(`Missing gateway PEM: ${gatewayPemPath}`);
    process.exit(1);
  }

  if (process.env.CASE_REGISTRY_ADDR && String(process.env.CASE_REGISTRY_ADDR).trim() !== '' && !args.force) {
    console.error(
      'CASE_REGISTRY_ADDR is already set. Redeploy with --force or unset it first.'
    );
    process.exit(1);
  }

  const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');
  const binPath = path.join(apiRoot, 'build', 'CaseRegistry.bin');

  if (args.compile) {
    const r = spawnSync(process.execPath, [path.join(apiRoot, 'scripts', 'compile.js'), 'contracts/CaseRegistry.sol'], {
      cwd: apiRoot,
      encoding: 'utf8'
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout || 'compile failed');
      process.exit(1);
    }
  }

  if (!fs.existsSync(abiPath) || !fs.existsSync(binPath)) {
    console.error(`Missing ${abiPath} or ${binPath}. Run: npm run compile -- contracts/CaseRegistry.sol`);
    process.exit(1);
  }

  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  let bin = fs.readFileSync(binPath, 'utf8').trim();
  if (!bin.startsWith('0x')) {
    bin = `0x${bin}`;
  }

  const cfg = new Configuration(path.resolve(fiscoConfigPath));
  const web3j = new Web3jService(cfg);

  console.error('Deploying CaseRegistry (constructor has no args)...');
  const receipt = await web3j.deploy(abi, bin, [], 'gateway');

  if (!receiptStatusOk(receipt)) {
    console.error('Deploy receipt not successful:', JSON.stringify(receipt).slice(0, 800));
    process.exit(1);
  }

  const addr = receipt.contractAddress;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    console.error('Missing contractAddress in receipt:', JSON.stringify(receipt).slice(0, 800));
    process.exit(1);
  }

  const normalized = addr.toLowerCase();

  upsertEnvVar(
    args.envFile,
    'CASE_REGISTRY_ADDR',
    normalized,
    '# CaseRegistry contract (scripts/deploy-contract.js)'
  );

  console.log(JSON.stringify({
    contractAddress: normalized,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    envFile: args.envFile
  }, null, 2));

  console.error(`\nWrote CASE_REGISTRY_ADDR=${normalized} to ${args.envFile}`);
  console.error('Import this contract in WeBASE (ABI from build/CaseRegistry.abi) to decode calls.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
