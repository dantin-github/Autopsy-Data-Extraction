'use strict';

/**
 * Call CaseRegistry.police(address) / judges(address) for each user in data/users.json
 * (same Node SDK + conf as seed-roles). Use when FISCO Java console is not installed.
 *
 *   npm run verify-case-registry-roles
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Configuration, Web3jService } = require('fisco-bcos');
const ethers = require('ethers');

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

async function main() {
  const contractAddr = String(process.env.CASE_REGISTRY_ADDR || '').trim();
  if (!contractAddr || !/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) {
    console.error('Set CASE_REGISTRY_ADDR in .env');
    process.exit(1);
  }

  const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');
  if (!fs.existsSync(abiPath)) {
    console.error('Missing build/CaseRegistry.abi — run: npm run compile -- contracts/CaseRegistry.sol');
    process.exit(1);
  }
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

  const usersPath = usersFilePath();
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  if (!Array.isArray(users)) {
    throw new Error('users.json must be an array');
  }

  const fiscoConfigPath = resolveFiscoConfigPath();
  const gatewayPem = path.join(path.dirname(fiscoConfigPath), 'accounts', 'gateway.pem');
  if (!fs.existsSync(fiscoConfigPath) || !fs.existsSync(gatewayPem)) {
    console.error('Missing FISCO config or gateway.pem (see npm run copy-chain-certs)');
    process.exit(1);
  }

  const cfg = new Configuration(path.resolve(fiscoConfigPath));
  const web3j = new Web3jService(cfg);

  const rows = [];
  for (const u of users) {
    const userId = String(u.userId || '');
    const role = String(u.role || '').toLowerCase();
    const addr = u.onchainAddress != null ? String(u.onchainAddress).trim() : '';
    if (!addr) {
      rows.push({ userId, role, onchainAddress: '(missing)', police: null, judges: null, ok: false });
      continue;
    }
    const a = addr.startsWith('0x') ? addr : `0x${addr}`;
    const p = decodeBoolView(await web3j.call(contractAddr, pickFn(abi, 'police'), [a], 'gateway'));
    const j = decodeBoolView(await web3j.call(contractAddr, pickFn(abi, 'judges'), [a], 'gateway'));
    const expectPolice = role === 'police';
    const ok = expectPolice ? p && !j : !p && j;
    rows.push({ userId, role, onchainAddress: a.toLowerCase(), police: p, judges: j, ok });
  }

  console.log(JSON.stringify({ contract: contractAddr.toLowerCase(), users: rows }, null, 2));

  const bad = rows.filter((r) => r.onchainAddress !== '(missing)' && !r.ok);
  if (bad.length) {
    console.error(`Mismatch or wrong role flags for: ${bad.map((x) => x.userId).join(', ')}`);
    process.exit(1);
  }
  const missing = rows.filter((r) => r.onchainAddress === '(missing)');
  if (missing.length) {
    console.error(`Missing onchainAddress for: ${missing.map((x) => x.userId).join(', ')} — run: npm run seed-roles`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
