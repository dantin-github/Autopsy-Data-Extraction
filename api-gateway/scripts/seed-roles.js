'use strict';

/**
 * S5.3: For each row in data/users.json, generate a secp256k1 keypair, encrypt private key
 * with that user's login password (from data/users.example.json, matched by userId), write
 * data/keystore/<userId>.enc, then register the address on CaseRegistry via addPolice / addJudge
 * (onlyOwner — uses gateway account). Updates users.json with onchainAddress.
 *
 * Prerequisites:
 *   - npm run seed-users (users.json exists)
 *   - users.example.json still contains passwordPlain for each userId (used only by this script)
 *   - .env: CASE_REGISTRY_ADDR, FISCO_CONFIG + conf/accounts/gateway.pem
 *
 * Usage (from api-gateway):
 *   node scripts/seed-roles.js
 *   node scripts/seed-roles.js --keystore-only    # write .enc + users.json only (no ABI / chain)
 *   node scripts/seed-roles.js --ensure           # skip users who already have onchainAddress + .enc
 *
 * Env: USERS_FILE, USERS_EXAMPLE_FILE (override paths; default data/users.json + data/users.example.json)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Configuration, Web3jService } = require('fisco-bcos');
const ethers = require('ethers');

const keystore = require('../src/services/keystore');

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

function usersFilePath() {
  const raw = process.env.USERS_FILE;
  if (raw != null && String(raw).trim() !== '') {
    return path.resolve(process.cwd(), String(raw).trim());
  }
  return path.join(apiRoot, 'data', 'users.json');
}

function examplePasswordFilePath() {
  const raw = process.env.USERS_EXAMPLE_FILE;
  if (raw != null && String(raw).trim() !== '') {
    return path.resolve(process.cwd(), String(raw).trim());
  }
  return path.join(apiRoot, 'data', 'users.example.json');
}

function pickFn(abi, name) {
  const f = abi.find((x) => x.type === 'function' && x.name === name);
  if (!f) {
    throw new Error(`ABI missing function: ${name}`);
  }
  return f;
}

function callResultHex(resp) {
  if (resp == null) {
    throw new Error('call: empty response');
  }
  let r = resp.result;
  if (r != null && typeof r === 'object' && r.output != null) {
    r = r.output;
  }
  if (typeof r !== 'string' || r === '') {
    throw new Error(`call: unexpected result: ${JSON.stringify(resp).slice(0, 200)}`);
  }
  return r.startsWith('0x') ? r : `0x${r}`;
}

function decodeBoolView(resp) {
  const hex = callResultHex(resp);
  const [v] = ethers.utils.defaultAbiCoder.decode(['bool'], hex);
  return Boolean(v);
}

function receiptOk(receipt) {
  if (!receipt || receipt.status === undefined || receipt.status === null) {
    return true;
  }
  const n = typeof receipt.status === 'string' ? parseInt(receipt.status, 16) : Number(receipt.status);
  return n === 0;
}

function loadExamplePasswordMap() {
  const examplePath = examplePasswordFilePath();
  if (!fs.existsSync(examplePath)) {
    throw new Error(`Missing ${examplePath}`);
  }
  const rows = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error('users.example.json must be an array');
  }
  const map = new Map();
  for (const row of rows) {
    if (row.userId && row.passwordPlain != null && String(row.passwordPlain) !== '') {
      map.set(String(row.userId), String(row.passwordPlain));
    }
  }
  return map;
}

function parseArgs(argv) {
  const out = { keystoreOnly: false, help: false, ensure: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keystore-only') {
      out.keystoreOnly = true;
    } else if (a === '--ensure') {
      out.ensure = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/seed-roles.js [--keystore-only] [--ensure] [--help]
  --keystore-only   Write data/keystore/*.enc and onchainAddress in users.json only (no chain)
  --ensure          Skip users that already have a valid onchainAddress and data/keystore/<userId>.enc
  Env: USERS_FILE, USERS_EXAMPLE_FILE — override user list and password source paths`);
    process.exit(0);
  }

  const keystoreOnly = args.keystoreOnly;
  const ensure = args.ensure;

  const usersPath = usersFilePath();
  if (!fs.existsSync(usersPath)) {
    console.error(`Missing ${usersPath} (run: npm run seed-users)`);
    process.exit(1);
  }

  const passwordByUserId = loadExamplePasswordMap();
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  if (!Array.isArray(users)) {
    throw new Error('users.json must be an array');
  }

  const keystoreDir = path.join(apiRoot, 'data', 'keystore');
  fs.mkdirSync(keystoreDir, { recursive: true });

  let abi = null;
  if (!keystoreOnly) {
    const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');
    if (!fs.existsSync(abiPath)) {
      console.error('Missing build/CaseRegistry.abi — run: npm run compile -- contracts/CaseRegistry.sol');
      process.exit(1);
    }
    abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  }

  const contractAddr = String(process.env.CASE_REGISTRY_ADDR || '').trim();
  if (!contractAddr && !keystoreOnly) {
    console.error('CASE_REGISTRY_ADDR is not set in .env (run: npm run deploy-contract)');
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddr) && !keystoreOnly) {
    console.error('CASE_REGISTRY_ADDR must be a 0x-prefixed 20-byte address');
    process.exit(1);
  }

  let web3j = null;
  if (!keystoreOnly) {
    const fiscoConfigPath = resolveFiscoConfigPath();
    const gatewayPem = path.join(path.dirname(fiscoConfigPath), 'accounts', 'gateway.pem');
    if (!fs.existsSync(fiscoConfigPath) || !fs.existsSync(gatewayPem)) {
      console.error('Missing FISCO config or gateway.pem (see npm run copy-chain-certs)');
      process.exit(1);
    }
    const cfg = new Configuration(path.resolve(fiscoConfigPath));
    web3j = new Web3jService(cfg);
  }

  const out = [];
  let ensureSkipped = 0;

  for (const row of users) {
    const userId = String(row.userId || '').trim();
    if (!userId) {
      throw new Error('user row missing userId');
    }
    const role = String(row.role || '').toLowerCase();
    const pwd = passwordByUserId.get(userId);
    if (!pwd) {
      throw new Error(
        `No passwordPlain for userId "${userId}" in ${examplePasswordFilePath()} — add it to run seed-roles`
      );
    }

    const encPath = path.join(keystoreDir, `${userId}.enc`);
    const existingAddr =
      row.onchainAddress != null ? String(row.onchainAddress).trim().toLowerCase() : '';
    const alreadyReady =
      ensure &&
      /^0x[0-9a-f]{40}$/.test(existingAddr) &&
      fs.existsSync(encPath);
    if (alreadyReady) {
      out.push(row);
      ensureSkipped += 1;
      continue;
    }

    const kp = keystore.generateKeypair();
    const enc = keystore.encrypt(kp.privateKey, pwd);
    fs.writeFileSync(encPath, `${JSON.stringify(enc, null, 2)}\n`, 'utf8');
    console.error(`Wrote ${path.relative(apiRoot, encPath)} → ${kp.address}`);

    if (!keystoreOnly) {
      const fn = role === 'police' ? 'addPolice' : role === 'judge' ? 'addJudge' : null;
      if (!fn) {
        throw new Error(`Unknown role "${row.role}" for ${userId} (expected police or judge)`);
      }
      const receipt = await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, fn),
        [kp.address],
        'gateway'
      );
      if (!receiptOk(receipt)) {
        console.error('Receipt:', JSON.stringify(receipt).slice(0, 500));
        throw new Error(`${fn} failed for ${userId}`);
      }
      const txHash = receipt.transactionHash;

      const viewFn = role === 'police' ? 'police' : 'judges';
      const ok = decodeBoolView(
        await web3j.call(contractAddr, pickFn(abi, viewFn), [kp.address], 'gateway')
      );
      if (!ok) {
        throw new Error(`on-chain ${viewFn}(${kp.address}) expected true after ${fn}`);
      }
      console.error(`Chain ${fn} ok tx=${txHash}`);
    }

    out.push({
      ...row,
      onchainAddress: kp.address.toLowerCase()
    });
  }

  if (ensure && ensureSkipped === users.length) {
    console.error(
      'seed-roles --ensure: all users already have keystore + onchainAddress; no changes.'
    );
    process.exit(0);
  }

  fs.writeFileSync(usersPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.error(`Updated ${usersPath} with onchainAddress for ${out.length} users.`);

  console.log(
    JSON.stringify(
      {
        usersFile: usersPath,
        keystoreDir: path.relative(apiRoot, keystoreDir),
        contract: keystoreOnly ? null : contractAddr,
        keystoreOnly,
        ensure
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
