'use strict';

/**
 * S4.3: deploy CaseRegistry on a live FISCO BCOS group, run createRecord → propose → approve → execute,
 * assert receipts status=0x0, parse events, verify getProposal / getRecordHash.
 *
 * Skips when conf/fisco-config.json or conf/accounts/gateway.pem is missing (same idea as chain.crud.test.js).
 * Temporarily merges two ecrandom accounts (police / judge) into a copy of fisco-config so no extra PEM files are required.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

const { Configuration, Web3jService } = require('fisco-bcos');
const ethers = require('ethers');

const apiRoot = path.join(__dirname, '..');
const fiscoConfigPath = path.join(apiRoot, 'conf', 'fisco-config.json');
const gatewayPemPath = path.join(apiRoot, 'conf', 'accounts', 'gateway.pem');

function pickFn(abi, name) {
  const f = abi.find((x) => x.type === 'function' && x.name === name);
  if (!f) {
    throw new Error(`ABI missing function: ${name}`);
  }
  return f;
}

function assertReceiptSuccess(receipt, label) {
  if (!receipt || receipt.status === undefined || receipt.status === null) {
    return;
  }
  const st = receipt.status;
  const n = typeof st === 'string' ? parseInt(st, 16) : Number(st);
  assert.strictEqual(n, 0, `${label}: expected status 0, got ${st}`);
}

function parseEventNames(receipt, iface) {
  const names = [];
  for (const log of receipt.logs || []) {
    try {
      const ev = iface.parseLog(log);
      if (ev && ev.name) {
        names.push(ev.name);
      }
    } catch (_) {
      /* ignore non-matching logs */
    }
  }
  return names;
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
    throw new Error(`call: unexpected result shape: ${JSON.stringify(resp).slice(0, 400)}`);
  }
  return r.startsWith('0x') ? r : `0x${r}`;
}

function decodeGetProposal(resp, abi) {
  const hex = callResultHex(resp);
  const fn = abi.find((x) => x.type === 'function' && x.name === 'getProposal');
  const types = fn.outputs.map((o) => o.type);
  return ethers.utils.defaultAbiCoder.decode(types, hex);
}

function decodeGetRecordHash(resp) {
  const hex = callResultHex(resp);
  const [h] = ethers.utils.defaultAbiCoder.decode(['bytes32'], hex);
  return h;
}

test('S4.3: CaseRegistry happy path on chain (deploy + events + getProposal)', async () => {
  if (!fs.existsSync(fiscoConfigPath) || !fs.existsSync(gatewayPemPath)) {
    console.log('skip: conf/fisco-config.json or conf/accounts/gateway.pem missing');
    return;
  }
  if (['0', 'false', 'no'].includes(String(process.env.CONTRACT_POSITIVE || '').toLowerCase())) {
    console.log('skip: CONTRACT_POSITIVE disabled');
    return;
  }

  const compile = spawnSync(process.execPath, [path.join(apiRoot, 'scripts', 'compile.js'), 'contracts/CaseRegistry.sol'], {
    cwd: apiRoot,
    encoding: 'utf8'
  });
  assert.strictEqual(compile.status, 0, compile.stderr || compile.stdout);

  const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');
  const binPath = path.join(apiRoot, 'build', 'CaseRegistry.bin');
  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  let bin = fs.readFileSync(binPath, 'utf8').trim();
  if (!bin.startsWith('0x')) {
    bin = `0x${bin}`;
  }

  const base = JSON.parse(fs.readFileSync(fiscoConfigPath, 'utf8'));
  if (!base.accounts || !base.accounts.gateway) {
    console.log('skip: fisco-config has no gateway account');
    return;
  }
  base.accounts = { ...base.accounts };
  base.accounts.police = {
    type: 'ecrandom',
    value: crypto.randomBytes(32).toString('hex')
  };
  base.accounts.police2 = {
    type: 'ecrandom',
    value: crypto.randomBytes(32).toString('hex')
  };
  base.accounts.judge = {
    type: 'ecrandom',
    value: crypto.randomBytes(32).toString('hex')
  };

  const tmpPath = path.join(apiRoot, 'conf', '.fisco-contract-positive-tmp.json');
  fs.writeFileSync(tmpPath, `${JSON.stringify(base, null, 2)}\n`, 'utf8');

  let web3j;
  try {
    const cfg = new Configuration(tmpPath);
    web3j = new Web3jService(cfg);

    const policeAddr = cfg.accounts.police.account;
    const police2Addr = cfg.accounts.police2.account;
    const judgeAddr = cfg.accounts.judge.account;

    const deployReceipt = await web3j.deploy(abi, bin, [], 'gateway');
    assertReceiptSuccess(deployReceipt, 'deploy');
    const contractAddr = deployReceipt.contractAddress;
    assert.ok(contractAddr && /^0x[0-9a-fA-F]{40}$/.test(contractAddr), 'contract address');

    const iface = new ethers.utils.Interface(abi);

    const rAddP = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addPolice'), [policeAddr], 'gateway');
    assertReceiptSuccess(rAddP, 'addPolice');

    const rAddP2 = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addPolice'), [police2Addr], 'gateway');
    assertReceiptSuccess(rAddP2, 'addPolice2');

    const rAddJ = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addJudge'), [judgeAddr], 'gateway');
    assertReceiptSuccess(rAddJ, 'addJudge');

    const indexHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const recordHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const newHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const proposalId = `0x${crypto.randomBytes(32).toString('hex')}`;

    const rCreate = await web3j.sendRawTransaction(
      contractAddr,
      pickFn(abi, 'createRecord'),
      [indexHash, recordHash],
      'police'
    );
    assertReceiptSuccess(rCreate, 'createRecord');
    const evCreate = parseEventNames(rCreate, iface);
    assert.ok(evCreate.includes('RecordCreated'), `expected RecordCreated, got ${evCreate.join(',')}`);

    const rProp = await web3j.sendRawTransaction(
      contractAddr,
      pickFn(abi, 'propose'),
      [proposalId, indexHash, recordHash, newHash, 'audit trail'],
      'police'
    );
    assertReceiptSuccess(rProp, 'propose');
    const evProp = parseEventNames(rProp, iface);
    assert.ok(evProp.includes('ProposalCreated'), `expected ProposalCreated, got ${evProp.join(',')}`);

    const viewPending = await web3j.call(contractAddr, pickFn(abi, 'getProposal'), [proposalId], 'gateway');
    const decP = decodeGetProposal(viewPending, abi);
    assert.strictEqual(Number(decP[5]), 1, 'status Pending');

    const rApp = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'approve'), [proposalId], 'judge');
    assertReceiptSuccess(rApp, 'approve');
    const evApp = parseEventNames(rApp, iface);
    assert.ok(evApp.includes('ProposalApproved'), `expected ProposalApproved, got ${evApp.join(',')}`);

    const viewApproved = await web3j.call(contractAddr, pickFn(abi, 'getProposal'), [proposalId], 'gateway');
    const decA = decodeGetProposal(viewApproved, abi);
    assert.strictEqual(Number(decA[5]), 2, 'status Approved');
    assert.strictEqual(String(decA[4]).toLowerCase(), judgeAddr.toLowerCase(), 'approver is judge');

    const rExec = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'execute'), [proposalId], 'police2');
    assertReceiptSuccess(rExec, 'execute');
    const evEx = parseEventNames(rExec, iface);
    assert.ok(evEx.includes('ProposalExecuted'), `expected ProposalExecuted, got ${evEx.join(',')}`);

    const viewDone = await web3j.call(contractAddr, pickFn(abi, 'getProposal'), [proposalId], 'gateway');
    const decE = decodeGetProposal(viewDone, abi);
    assert.strictEqual(Number(decE[5]), 4, 'status Executed');

    const rhResp = await web3j.call(contractAddr, pickFn(abi, 'getRecordHash'), [indexHash], 'gateway');
    const onChainHash = decodeGetRecordHash(rhResp);
    assert.strictEqual(String(onChainHash).toLowerCase(), newHash.toLowerCase(), 'record hash updated after execute');
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
});
