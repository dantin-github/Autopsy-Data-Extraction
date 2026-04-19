'use strict';

/**
 * S4.4: six revert scenarios on deployed CaseRegistry (FISCO BCOS + fisco-bcos SDK).
 * Writes one JSON line per scenario to docs/evidence/negative-cases/s4.4-manifest.jsonl
 *
 * Skips without chain config (same as contract-positive). CONTRACT_NEGATIVE=0 skips.
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
const repoRoot = path.join(apiRoot, '..');
const fiscoConfigPath = path.join(apiRoot, 'conf', 'fisco-config.json');
const gatewayPemPath = path.join(apiRoot, 'conf', 'accounts', 'gateway.pem');
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'negative-cases');
const evidenceFile = path.join(evidenceDir, 's4.4-manifest.jsonl');

function pickFn(abi, name) {
  const f = abi.find((x) => x.type === 'function' && x.name === name);
  if (!f) {
    throw new Error(`ABI missing function: ${name}`);
  }
  return f;
}

function receiptStatusNum(receipt) {
  if (!receipt || receipt.status === undefined || receipt.status === null) {
    return null;
  }
  const st = receipt.status;
  return typeof st === 'string' ? parseInt(st, 16) : Number(st);
}

function getReceiptOutput(receipt) {
  if (!receipt) {
    return null;
  }
  const o = receipt.output != null ? receipt.output : receipt.ret;
  if (o && o !== '0x' && o !== '') {
    return o;
  }
  return null;
}

function decodeRevertReason(outputHex) {
  if (!outputHex || outputHex === '0x') {
    return null;
  }
  const full = outputHex.startsWith('0x') ? outputHex : `0x${outputHex}`;
  if (full.length < 10) {
    return null;
  }
  if (full.slice(0, 10).toLowerCase() !== '0x08c379a0') {
    return null;
  }
  const rest = `0x${full.slice(10)}`;
  try {
    const [s] = ethers.utils.defaultAbiCoder.decode(['string'], rest);
    return s;
  } catch {
    return null;
  }
}

function assertRevert(receipt, expectedSubstring, label) {
  const n = receiptStatusNum(receipt);
  assert.ok(n != null && n !== 0, `${label}: expected failed tx (status !== 0), got ${receipt && receipt.status}`);
  const out = getReceiptOutput(receipt);
  const reason = out ? decodeRevertReason(out) : null;
  assert.ok(
    reason && (reason === expectedSubstring || reason.includes(expectedSubstring)),
    `${label}: expected revert containing "${expectedSubstring}", got reason=${JSON.stringify(reason)} output=${JSON.stringify(
      out
    )}`
  );
}

function appendEvidence(row) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.appendFileSync(evidenceFile, `${JSON.stringify(row)}\n`, 'utf8');
}

test('S4.4: CaseRegistry revert scenarios + evidence manifest', async (t) => {
  if (!fs.existsSync(fiscoConfigPath) || !fs.existsSync(gatewayPemPath)) {
    console.log('skip: conf/fisco-config.json or conf/accounts/gateway.pem missing');
    return;
  }
  if (['0', 'false', 'no'].includes(String(process.env.CONTRACT_NEGATIVE || '').toLowerCase())) {
    console.log('skip: CONTRACT_NEGATIVE disabled');
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
  base.accounts.police = { type: 'ecrandom', value: crypto.randomBytes(32).toString('hex') };
  base.accounts.police2 = { type: 'ecrandom', value: crypto.randomBytes(32).toString('hex') };
  base.accounts.judge = { type: 'ecrandom', value: crypto.randomBytes(32).toString('hex') };

  const tmpPath = path.join(apiRoot, 'conf', '.fisco-contract-negative-tmp.json');
  fs.writeFileSync(tmpPath, `${JSON.stringify(base, null, 2)}\n`, 'utf8');

  if (fs.existsSync(evidenceFile)) {
    fs.unlinkSync(evidenceFile);
  }

  let web3j;
  try {
    const cfg = new Configuration(tmpPath);
    web3j = new Web3jService(cfg);
    const p1 = cfg.accounts.police.account;
    const p2 = cfg.accounts.police2.account;
    const j = cfg.accounts.judge.account;

    const deployReceipt = await web3j.deploy(abi, bin, [], 'gateway');
    assert.strictEqual(receiptStatusNum(deployReceipt), 0, 'deploy');
    const contractAddr = deployReceipt.contractAddress;
    assert.ok(/^0x[0-9a-fA-F]{40}$/i.test(contractAddr));

    await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addPolice'), [p1], 'gateway');
    await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addPolice'), [p2], 'gateway');
    await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addJudge'), [j], 'gateway');

    const record = (prefix) => ({
      ih: `0x${crypto.randomBytes(32).toString('hex')}`,
      rh: `0x${crypto.randomBytes(32).toString('hex')}`,
      nh: `0x${crypto.randomBytes(32).toString('hex')}`,
      pid: `0x${crypto.randomBytes(32).toString('hex')}`,
      prefix
    });

    await t.test('non-police createRecord → not police', async () => {
      const { ih, rh } = record('s1');
      const r = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'gateway');
      assertRevert(r, 'not police', 's1');
      appendEvidence({
        scenario: 'non_police_createRecord',
        expected: 'not police',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });

    await t.test('police approve → not judge', async () => {
      const { ih, rh, nh, pid } = record('s2');
      await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'police');
      await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, ''],
        'police'
      );
      const r = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'approve'), [pid], 'police');
      assertRevert(r, 'not judge', 's2');
      appendEvidence({
        scenario: 'non_judge_approve',
        expected: 'not judge',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });

    await t.test('execute without approve → not approved', async () => {
      const { ih, rh, nh, pid } = record('s4');
      await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'police');
      await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, ''],
        'police'
      );
      const r = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'execute'), [pid], 'police');
      assertRevert(r, 'not approved', 'execute_no_approve');
      appendEvidence({
        scenario: 'execute_without_approve',
        expected: 'not approved',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });

    await t.test('duplicate proposalId → proposal exists', async () => {
      const { ih, rh, nh, pid } = record('s6');
      await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'police');
      await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, ''],
        'police'
      );
      const r = await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, 'dup'],
        'police'
      );
      assertRevert(r, 'proposal exists', 'dup_proposal');
      appendEvidence({
        scenario: 'duplicate_proposalId',
        expected: 'proposal exists',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });

    await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'addJudge'), [p1], 'gateway');

    await t.test('same address police+judge self-approve → self approve', async () => {
      const { ih, rh, nh, pid } = record('s3');
      await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'police');
      await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, ''],
        'police'
      );
      const r = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'approve'), [pid], 'police');
      assertRevert(r, 'self approve', 'self_approve');
      appendEvidence({
        scenario: 'self_approve',
        expected: 'self approve',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });

    await t.test('wrong police executes after judge approve → not proposer', async () => {
      const { ih, rh, nh, pid } = record('s5');
      await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'createRecord'), [ih, rh], 'police');
      await web3j.sendRawTransaction(
        contractAddr,
        pickFn(abi, 'propose'),
        [pid, ih, rh, nh, ''],
        'police'
      );
      const rOk = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'approve'), [pid], 'judge');
      assert.strictEqual(receiptStatusNum(rOk), 0, 'approve ok');
      const r = await web3j.sendRawTransaction(contractAddr, pickFn(abi, 'execute'), [pid], 'police2');
      assertRevert(r, 'not proposer', 'wrong_executor');
      appendEvidence({
        scenario: 'non_proposer_execute',
        expected: 'not proposer',
        txHash: r.transactionHash,
        status: r.status,
        revertReason: decodeRevertReason(getReceiptOutput(r))
      });
    });
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
});
