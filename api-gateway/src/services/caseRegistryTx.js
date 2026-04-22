'use strict';

/**
 * S5.4: CaseRegistry.createRecord signed with the police user's decrypted keystore (FISCO ecrandom account).
 * Requires npm run seed-roles so users.json has onchainAddress and data/keystore/<userId>.enc exists.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Configuration, Web3jService } = require('fisco-bcos');
const ethers = require('ethers');

const config = require('../config');
const keystore = require('./keystore');
const chain = require('./chain');
const userStore = require('./userStore');
const { parseReceiptBlockNumber } = require('./receiptBlockNumber');

/** Project root `api-gateway/` (this file lives in `src/services/`) */
const apiRoot = path.join(__dirname, '..', '..');

function pickFn(abi, name) {
  const f = abi.find((x) => x.type === 'function' && x.name === name);
  if (!f) {
    throw new Error(`ABI missing function: ${name}`);
  }
  return f;
}

/** @returns {string} 0x + 64 hex */
function toBytes32(hexMaybe) {
  const s = String(hexMaybe || '')
    .trim()
    .replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error('expected 32-byte hex string (64 hex chars)');
  }
  return `0x${s.toLowerCase()}`;
}

function receiptOk(receipt) {
  if (!receipt || receipt.status === undefined || receipt.status === null) {
    return true;
  }
  const n = typeof receipt.status === 'string' ? parseInt(receipt.status, 16) : Number(receipt.status);
  return n === 0;
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

function parseProposalCreatedFromReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    return null;
  }
  let abi;
  try {
    abi = loadAbi();
  } catch {
    return null;
  }
  const iface = new ethers.utils.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'ProposalCreated') {
        return {
          proposalId: ethers.utils.hexlify(parsed.args.proposalId).toLowerCase(),
          indexHash: ethers.utils.hexlify(parsed.args.indexHash).toLowerCase(),
          proposer: parsed.args.proposer.toString().toLowerCase()
        };
      }
    } catch (_) {
      /* ignore non-matching logs */
    }
  }
  return null;
}

function parseProposalApprovedFromReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    return null;
  }
  let abi;
  try {
    abi = loadAbi();
  } catch {
    return null;
  }
  const iface = new ethers.utils.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'ProposalApproved') {
        return {
          proposalId: ethers.utils.hexlify(parsed.args.proposalId).toLowerCase(),
          approver: parsed.args.approver.toString().toLowerCase()
        };
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function parseProposalRejectedFromReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    return null;
  }
  let abi;
  try {
    abi = loadAbi();
  } catch {
    return null;
  }
  const iface = new ethers.utils.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'ProposalRejected') {
        return {
          proposalId: ethers.utils.hexlify(parsed.args.proposalId).toLowerCase(),
          approver: parsed.args.approver.toString().toLowerCase(),
          reason: parsed.args.reason != null ? String(parsed.args.reason) : ''
        };
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function parseProposalExecutedFromReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    return null;
  }
  let abi;
  try {
    abi = loadAbi();
  } catch {
    return null;
  }
  const iface = new ethers.utils.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'ProposalExecuted') {
        return {
          proposalId: ethers.utils.hexlify(parsed.args.proposalId).toLowerCase(),
          oldHash: ethers.utils.hexlify(parsed.args.oldHash).toLowerCase(),
          newHash: ethers.utils.hexlify(parsed.args.newHash).toLowerCase()
        };
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function decodeRevertReason(outputHex) {
  if (!outputHex || outputHex === '0x') {
    return null;
  }
  const full = outputHex.startsWith('0x') ? outputHex : `0x${outputHex}`;
  if (full.length < 10 || full.slice(0, 10).toLowerCase() !== '0x08c379a0') {
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

/**
 * Failed on-chain tx (receipt.status !== 0). Exposed to HTTP as `chainError` (S7.6).
 * @param {Record<string, number>} [statusByReason]
 */
function failedRawTxError(receipt, reasonRevert, opLabel, code, statusByReason) {
  const msg = reasonRevert || `${opLabel} failed (status ${receipt && receipt.status})`;
  const err = new Error(msg);
  err.code = code;
  err.receipt = receipt;
  err.chainError = {
    revertReason: reasonRevert || msg,
    txHash:
      receipt && receipt.transactionHash ? String(receipt.transactionHash).toLowerCase() : null
  };
  if (reasonRevert && statusByReason && statusByReason[reasonRevert] != null) {
    err.status = statusByReason[reasonRevert];
  } else {
    err.status = 400;
  }
  return err;
}

function loadAbi() {
  const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');
  if (!fs.existsSync(abiPath)) {
    const err = new Error(
      `Missing ${abiPath} — run: npm run compile -- contracts/CaseRegistry.sol`
    );
    err.code = 'CASE_REGISTRY_ABI_MISSING';
    throw err;
  }
  return JSON.parse(fs.readFileSync(abiPath, 'utf8'));
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

function isZeroBytes32(hex) {
  const s = String(hex || '')
    .replace(/^0x/i, '')
    .trim();
  return s.length === 0 || /^0+$/.test(s);
}

function contractAddrOrThrow() {
  const addr = String(config.caseRegistryAddr || '').trim();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    const err = new Error('CASE_REGISTRY_ADDR is not set or invalid');
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    throw err;
  }
  return addr;
}

/**
 * @returns {Promise<string|null>} lowercase 0x+64 hex or null if unset on chain
 */
async function getRecordHashOnRegistry(indexHashHex) {
  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const addr = contractAddrOrThrow();
  const abi = loadAbi();
  const indexB32 = toBytes32(indexHashHex);
  const cfg = new Configuration(path.resolve(config.fiscoConfigPath));
  const web3j = new Web3jService(cfg);
  const resp = await web3j.call(addr, pickFn(abi, 'getRecordHash'), [indexB32], 'gateway');
  const hex = callResultHex(resp);
  const [h] = ethers.utils.defaultAbiCoder.decode(['bytes32'], hex);
  const out = ethers.utils.hexlify(h).toLowerCase();
  return isZeroBytes32(out) ? null : out;
}

const STATUS_NAMES = ['None', 'Pending', 'Approved', 'Rejected', 'Executed'];

/**
 * @returns {Promise<object>} decoded proposal + statusName
 */
async function getProposalFromRegistry(proposalIdHex) {
  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const addr = contractAddrOrThrow();
  const abi = loadAbi();
  const pidB32 = toBytes32(proposalIdHex);
  const cfg = new Configuration(path.resolve(config.fiscoConfigPath));
  const web3j = new Web3jService(cfg);
  const resp = await web3j.call(addr, pickFn(abi, 'getProposal'), [pidB32], 'gateway');
  const hex = callResultHex(resp);
  const fn = pickFn(abi, 'getProposal');
  const types = fn.outputs.map((o) => o.type);
  const dec = ethers.utils.defaultAbiCoder.decode(types, hex);
  const statusNum = Number(dec[5]);
  return {
    indexHash: ethers.utils.hexlify(dec[0]).toLowerCase(),
    oldRecordHash: ethers.utils.hexlify(dec[1]).toLowerCase(),
    newRecordHash: ethers.utils.hexlify(dec[2]).toLowerCase(),
    proposer: String(dec[3]).toLowerCase(),
    approver:
      dec[4] && String(dec[4]).toLowerCase() !== '0x0000000000000000000000000000000000000000'
        ? String(dec[4]).toLowerCase()
        : null,
    status: statusNum,
    statusName: STATUS_NAMES[statusNum] || 'Unknown',
    proposedAt: dec[6] != null ? dec[6].toString() : '0',
    decidedAt: dec[7] != null ? dec[7].toString() : '0',
    reason: dec[8] != null ? String(dec[8]) : ''
  };
}

/**
 * @param {{ userId: string, signingPassword: string, proposalIdHex: string, indexHashHex: string, oldRecordHashHex: string, newRecordHashHex: string, reason: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number, proposalCreated: { proposalId: string, indexHash: string, proposer: string }|null }>}
 */
async function proposeFromUserKeystore(opts) {
  const userId = String(opts.userId || '').trim();
  const signingPassword = opts.signingPassword != null ? String(opts.signingPassword) : '';
  const reason = opts.reason != null ? String(opts.reason) : '';
  if (!userId || !signingPassword) {
    const err = new Error('userId and signingPassword are required');
    err.status = 400;
    throw err;
  }

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }

  const addr = contractAddrOrThrow();

  const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
  if (!fs.existsSync(encPath)) {
    const err = new Error(`Missing keystore file ${encPath} (run: npm run seed-roles)`);
    err.code = 'KEYSTORE_MISSING';
    err.status = 400;
    throw err;
  }

  const userRow = userStore.findByUserId(userId);
  if (!userRow || String(userRow.role || '').toLowerCase() !== 'police') {
    const err = new Error('propose is only for police accounts');
    err.code = 'NOT_POLICE';
    err.status = 403;
    throw err;
  }
  const onchain = userRow && userRow.onchainAddress != null ? String(userRow.onchainAddress).trim() : '';
  if (!onchain || !/^0x[0-9a-fA-F]{40}$/i.test(onchain)) {
    const err = new Error('user has no onchainAddress — run: npm run seed-roles');
    err.code = 'ONCHAIN_ADDRESS_MISSING';
    err.status = 400;
    throw err;
  }

  let pkHex;
  try {
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    pkHex = keystore.decrypt(enc, signingPassword);
  } catch (e) {
    if (e && e.name === 'BadPassword') {
      const err = new Error('signing password incorrect');
      err.code = 'BAD_SIGNING_PASSWORD';
      err.status = 401;
      throw err;
    }
    throw e;
  }

  const wallet = new ethers.Wallet(`0x${pkHex}`);
  if (wallet.address.toLowerCase() !== onchain.toLowerCase()) {
    const err = new Error('keystore does not match onchainAddress — re-run seed-roles');
    err.code = 'KEYSTORE_ADDRESS_MISMATCH';
    err.status = 400;
    throw err;
  }

  const abi = loadAbi();
  const proposalB32 = toBytes32(opts.proposalIdHex);
  const indexB32 = toBytes32(opts.indexHashHex);
  const oldB32 = toBytes32(opts.oldRecordHashHex);
  const newB32 = toBytes32(opts.newRecordHashHex);

  const basePath = path.resolve(config.fiscoConfigPath);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const tmpName = `.fisco-propose-${crypto.randomBytes(12).toString('hex')}.json`;
  const tmpPath = path.join(path.dirname(basePath), tmpName);

  const merged = {
    ...base,
    accounts: {
      ...base.accounts,
      _uploadRole: { type: 'ecrandom', value: pkHex }
    }
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  try {
    const cfg = new Configuration(tmpPath);
    const web3j = new Web3jService(cfg);
    const receipt = await web3j.sendRawTransaction(
      addr,
      pickFn(abi, 'propose'),
      [proposalB32, indexB32, oldB32, newB32, reason],
      '_uploadRole'
    );
    if (!receiptOk(receipt)) {
      const out = getReceiptOutput(receipt);
      const reasonRevert = out ? decodeRevertReason(out) : null;
      throw failedRawTxError(receipt, reasonRevert, 'propose', 'PROPOSE_FAILED', {
        'proposal exists': 409,
        'old mismatch': 409
      });
    }
    const txHash = receipt.transactionHash;
    if (!txHash || typeof txHash !== 'string') {
      throw new Error('propose receipt missing transactionHash');
    }
    const blockNumber =
      receipt.blockNumber != null ? parseReceiptBlockNumber(receipt.blockNumber) : 0;
    const proposalCreated = parseProposalCreatedFromReceipt(receipt);
    return { txHash, blockNumber, proposalCreated };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Judge keystore → CaseRegistry.approve(proposalId).
 * @param {{ userId: string, signingPassword: string, proposalIdHex: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number, proposalApproved: { proposalId: string, approver: string }|null }>}
 */
async function approveFromUserKeystore(opts) {
  const userId = String(opts.userId || '').trim();
  const signingPassword = opts.signingPassword != null ? String(opts.signingPassword) : '';
  const proposalIdHex = opts.proposalIdHex != null ? String(opts.proposalIdHex).trim() : '';
  if (!userId || !signingPassword || !proposalIdHex) {
    const err = new Error('userId, signingPassword, and proposalId are required');
    err.status = 400;
    throw err;
  }

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }

  const addr = contractAddrOrThrow();

  const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
  if (!fs.existsSync(encPath)) {
    const err = new Error(`Missing keystore file ${encPath} (run: npm run seed-roles)`);
    err.code = 'KEYSTORE_MISSING';
    err.status = 400;
    throw err;
  }

  const userRow = userStore.findByUserId(userId);
  if (!userRow || String(userRow.role || '').toLowerCase() !== 'judge') {
    const err = new Error('approve is only for judge accounts');
    err.code = 'NOT_JUDGE';
    err.status = 403;
    throw err;
  }
  const onchain = userRow && userRow.onchainAddress != null ? String(userRow.onchainAddress).trim() : '';
  if (!onchain || !/^0x[0-9a-fA-F]{40}$/i.test(onchain)) {
    const err = new Error('user has no onchainAddress — run: npm run seed-roles');
    err.code = 'ONCHAIN_ADDRESS_MISSING';
    err.status = 400;
    throw err;
  }

  let pkHex;
  try {
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    pkHex = keystore.decrypt(enc, signingPassword);
  } catch (e) {
    if (e && e.name === 'BadPassword') {
      const err = new Error('signing password incorrect');
      err.code = 'BAD_SIGNING_PASSWORD';
      err.status = 401;
      throw err;
    }
    throw e;
  }

  const wallet = new ethers.Wallet(`0x${pkHex}`);
  if (wallet.address.toLowerCase() !== onchain.toLowerCase()) {
    const err = new Error('keystore does not match onchainAddress — re-run seed-roles');
    err.code = 'KEYSTORE_ADDRESS_MISMATCH';
    err.status = 400;
    throw err;
  }

  const abi = loadAbi();
  const proposalB32 = toBytes32(proposalIdHex);

  const basePath = path.resolve(config.fiscoConfigPath);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const tmpName = `.fisco-approve-${crypto.randomBytes(12).toString('hex')}.json`;
  const tmpPath = path.join(path.dirname(basePath), tmpName);

  const merged = {
    ...base,
    accounts: {
      ...base.accounts,
      _uploadRole: { type: 'ecrandom', value: pkHex }
    }
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  try {
    const cfg = new Configuration(tmpPath);
    const web3j = new Web3jService(cfg);
    const receipt = await web3j.sendRawTransaction(
      addr,
      pickFn(abi, 'approve'),
      [proposalB32],
      '_uploadRole'
    );
    if (!receiptOk(receipt)) {
      const out = getReceiptOutput(receipt);
      const reasonRevert = out ? decodeRevertReason(out) : null;
      throw failedRawTxError(receipt, reasonRevert, 'approve', 'APPROVE_FAILED', {
        'not pending': 409,
        'self approve': 403
      });
    }
    const txHash = receipt.transactionHash;
    if (!txHash || typeof txHash !== 'string') {
      throw new Error('approve receipt missing transactionHash');
    }
    const blockNumber =
      receipt.blockNumber != null ? parseReceiptBlockNumber(receipt.blockNumber) : 0;
    const proposalApproved = parseProposalApprovedFromReceipt(receipt);
    return { txHash, blockNumber, proposalApproved };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Judge keystore → CaseRegistry.reject(proposalId, reason).
 * @param {{ userId: string, signingPassword: string, proposalIdHex: string, rejectReason: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number, proposalRejected: { proposalId: string, approver: string, reason: string }|null }>}
 */
async function rejectFromUserKeystore(opts) {
  const userId = String(opts.userId || '').trim();
  const signingPassword = opts.signingPassword != null ? String(opts.signingPassword) : '';
  const proposalIdHex = opts.proposalIdHex != null ? String(opts.proposalIdHex).trim() : '';
  const rejectReason = opts.rejectReason != null ? String(opts.rejectReason) : '';
  if (!userId || !signingPassword || !proposalIdHex) {
    const err = new Error('userId, signingPassword, and proposalId are required');
    err.status = 400;
    throw err;
  }
  if (rejectReason.trim() === '') {
    const err = new Error('reject reason is required');
    err.status = 400;
    throw err;
  }

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }

  const addr = contractAddrOrThrow();

  const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
  if (!fs.existsSync(encPath)) {
    const err = new Error(`Missing keystore file ${encPath} (run: npm run seed-roles)`);
    err.code = 'KEYSTORE_MISSING';
    err.status = 400;
    throw err;
  }

  const userRow = userStore.findByUserId(userId);
  if (!userRow || String(userRow.role || '').toLowerCase() !== 'judge') {
    const err = new Error('reject is only for judge accounts');
    err.code = 'NOT_JUDGE';
    err.status = 403;
    throw err;
  }
  const onchain = userRow && userRow.onchainAddress != null ? String(userRow.onchainAddress).trim() : '';
  if (!onchain || !/^0x[0-9a-fA-F]{40}$/i.test(onchain)) {
    const err = new Error('user has no onchainAddress — run: npm run seed-roles');
    err.code = 'ONCHAIN_ADDRESS_MISSING';
    err.status = 400;
    throw err;
  }

  let pkHex;
  try {
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    pkHex = keystore.decrypt(enc, signingPassword);
  } catch (e) {
    if (e && e.name === 'BadPassword') {
      const err = new Error('signing password incorrect');
      err.code = 'BAD_SIGNING_PASSWORD';
      err.status = 401;
      throw err;
    }
    throw e;
  }

  const wallet = new ethers.Wallet(`0x${pkHex}`);
  if (wallet.address.toLowerCase() !== onchain.toLowerCase()) {
    const err = new Error('keystore does not match onchainAddress — re-run seed-roles');
    err.code = 'KEYSTORE_ADDRESS_MISMATCH';
    err.status = 400;
    throw err;
  }

  const abi = loadAbi();
  const proposalB32 = toBytes32(proposalIdHex);

  const basePath = path.resolve(config.fiscoConfigPath);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const tmpName = `.fisco-reject-${crypto.randomBytes(12).toString('hex')}.json`;
  const tmpPath = path.join(path.dirname(basePath), tmpName);

  const merged = {
    ...base,
    accounts: {
      ...base.accounts,
      _uploadRole: { type: 'ecrandom', value: pkHex }
    }
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  try {
    const cfg = new Configuration(tmpPath);
    const web3j = new Web3jService(cfg);
    const receipt = await web3j.sendRawTransaction(
      addr,
      pickFn(abi, 'reject'),
      [proposalB32, rejectReason],
      '_uploadRole'
    );
    if (!receiptOk(receipt)) {
      const out = getReceiptOutput(receipt);
      const reasonRevert = out ? decodeRevertReason(out) : null;
      throw failedRawTxError(receipt, reasonRevert, 'reject', 'REJECT_FAILED', {
        'not pending': 409,
        'self reject': 403
      });
    }
    const txHash = receipt.transactionHash;
    if (!txHash || typeof txHash !== 'string') {
      throw new Error('reject receipt missing transactionHash');
    }
    const blockNumber =
      receipt.blockNumber != null ? parseReceiptBlockNumber(receipt.blockNumber) : 0;
    const proposalRejected = parseProposalRejectedFromReceipt(receipt);
    return { txHash, blockNumber, proposalRejected };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Police keystore → CaseRegistry.execute(proposalId). Any police may execute after approve (contract allows gateway executor).
 * @param {{ userId: string, signingPassword: string, proposalIdHex: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number, proposalExecuted: { proposalId: string, oldHash: string, newHash: string }|null }>}
 */
async function executeFromUserKeystore(opts) {
  const userId = String(opts.userId || '').trim();
  const signingPassword = opts.signingPassword != null ? String(opts.signingPassword) : '';
  const proposalIdHex = opts.proposalIdHex != null ? String(opts.proposalIdHex).trim() : '';
  if (!userId || !signingPassword || !proposalIdHex) {
    const err = new Error('userId, signingPassword, and proposalId are required');
    err.status = 400;
    throw err;
  }

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }

  const addr = contractAddrOrThrow();

  const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
  if (!fs.existsSync(encPath)) {
    const err = new Error(`Missing keystore file ${encPath} (run: npm run seed-roles)`);
    err.code = 'KEYSTORE_MISSING';
    err.status = 400;
    throw err;
  }

  const userRow = userStore.findByUserId(userId);
  if (!userRow || String(userRow.role || '').toLowerCase() !== 'police') {
    const err = new Error('execute is only for police accounts');
    err.code = 'NOT_POLICE';
    err.status = 403;
    throw err;
  }
  const onchain = userRow && userRow.onchainAddress != null ? String(userRow.onchainAddress).trim() : '';
  if (!onchain || !/^0x[0-9a-fA-F]{40}$/i.test(onchain)) {
    const err = new Error('user has no onchainAddress — run: npm run seed-roles');
    err.code = 'ONCHAIN_ADDRESS_MISSING';
    err.status = 400;
    throw err;
  }

  let pkHex;
  try {
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    pkHex = keystore.decrypt(enc, signingPassword);
  } catch (e) {
    if (e && e.name === 'BadPassword') {
      const err = new Error('signing password incorrect');
      err.code = 'BAD_SIGNING_PASSWORD';
      err.status = 401;
      throw err;
    }
    throw e;
  }

  const wallet = new ethers.Wallet(`0x${pkHex}`);
  if (wallet.address.toLowerCase() !== onchain.toLowerCase()) {
    const err = new Error('keystore does not match onchainAddress — re-run seed-roles');
    err.code = 'KEYSTORE_ADDRESS_MISMATCH';
    err.status = 400;
    throw err;
  }

  const abi = loadAbi();
  const proposalB32 = toBytes32(proposalIdHex);

  const basePath = path.resolve(config.fiscoConfigPath);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const tmpName = `.fisco-execute-${crypto.randomBytes(12).toString('hex')}.json`;
  const tmpPath = path.join(path.dirname(basePath), tmpName);

  const merged = {
    ...base,
    accounts: {
      ...base.accounts,
      _uploadRole: { type: 'ecrandom', value: pkHex }
    }
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  try {
    const cfg = new Configuration(tmpPath);
    const web3j = new Web3jService(cfg);
    const receipt = await web3j.sendRawTransaction(
      addr,
      pickFn(abi, 'execute'),
      [proposalB32],
      '_uploadRole'
    );
    if (!receiptOk(receipt)) {
      const out = getReceiptOutput(receipt);
      const reasonRevert = out ? decodeRevertReason(out) : null;
      throw failedRawTxError(receipt, reasonRevert, 'execute', 'EXECUTE_FAILED', {
        'not approved': 409,
        'record changed': 409
      });
    }
    const txHash = receipt.transactionHash;
    if (!txHash || typeof txHash !== 'string') {
      throw new Error('execute receipt missing transactionHash');
    }
    const blockNumber =
      receipt.blockNumber != null ? parseReceiptBlockNumber(receipt.blockNumber) : 0;
    const proposalExecuted = parseProposalExecutedFromReceipt(receipt);
    return { txHash, blockNumber, proposalExecuted };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * system-executor keystore (EXECUTOR_KEYSTORE_PASSWORD) → CaseRegistry.execute(proposalId).
 * @param {{ proposalIdHex: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number, proposalExecuted: { proposalId: string, oldHash: string, newHash: string }|null }>}
 */
async function executeAsExecutor(opts) {
  const proposalIdHex = opts.proposalIdHex != null ? String(opts.proposalIdHex).trim() : '';
  if (!proposalIdHex) {
    const err = new Error('proposalId is required');
    err.status = 400;
    throw err;
  }

  const userId = String(config.executorUserId || '').trim();
  const signingPassword = config.executorKeystorePassword != null ? String(config.executorKeystorePassword) : '';
  if (!userId || !signingPassword) {
    const err = new Error(
      'EXECUTOR_KEYSTORE_PASSWORD (and EXECUTOR_USER_ID if overriding) must be set for automated execute'
    );
    err.code = 'EXECUTOR_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  return executeFromUserKeystore({ userId, signingPassword, proposalIdHex });
}

/**
 * @param {{ userId: string, signingPassword: string, indexHashHex: string, recordHashHex: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 */
async function createRecordFromUserKeystore(opts) {
  const userId = String(opts.userId || '').trim();
  const signingPassword = opts.signingPassword != null ? String(opts.signingPassword) : '';
  if (!userId || !signingPassword) {
    const err = new Error('userId and signingPassword are required');
    err.status = 400;
    throw err;
  }

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }

  const addr = String(config.caseRegistryAddr || '').trim();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    const err = new Error('CASE_REGISTRY_ADDR is not set or invalid');
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    throw err;
  }

  const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
  if (!fs.existsSync(encPath)) {
    const err = new Error(`Missing keystore file ${encPath} (run: npm run seed-roles)`);
    err.code = 'KEYSTORE_MISSING';
    err.status = 400;
    throw err;
  }

  const userRow = userStore.findByUserId(userId);
  if (!userRow || String(userRow.role || '').toLowerCase() !== 'police') {
    const err = new Error('CaseRegistry upload signing is only for police accounts');
    err.code = 'NOT_POLICE';
    err.status = 403;
    throw err;
  }
  const onchain = userRow && userRow.onchainAddress != null ? String(userRow.onchainAddress).trim() : '';
  if (!onchain || !/^0x[0-9a-fA-F]{40}$/i.test(onchain)) {
    const err = new Error('user has no onchainAddress — run: npm run seed-roles');
    err.code = 'ONCHAIN_ADDRESS_MISSING';
    err.status = 400;
    throw err;
  }

  let pkHex;
  try {
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    pkHex = keystore.decrypt(enc, signingPassword);
  } catch (e) {
    if (e && e.name === 'BadPassword') {
      const err = new Error('signing password incorrect');
      err.code = 'BAD_SIGNING_PASSWORD';
      err.status = 401;
      throw err;
    }
    throw e;
  }

  const wallet = new ethers.Wallet(`0x${pkHex}`);
  if (wallet.address.toLowerCase() !== onchain.toLowerCase()) {
    const err = new Error('keystore does not match onchainAddress — re-run seed-roles');
    err.code = 'KEYSTORE_ADDRESS_MISMATCH';
    err.status = 400;
    throw err;
  }

  const abi = loadAbi();
  const indexB32 = toBytes32(opts.indexHashHex);
  const recordB32 = toBytes32(opts.recordHashHex);

  const basePath = path.resolve(config.fiscoConfigPath);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const tmpName = `.fisco-upload-${crypto.randomBytes(12).toString('hex')}.json`;
  const tmpPath = path.join(path.dirname(basePath), tmpName);

  const merged = {
    ...base,
    accounts: {
      ...base.accounts,
      _uploadRole: { type: 'ecrandom', value: pkHex }
    }
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  let web3j;
  try {
    const cfg = new Configuration(tmpPath);
    web3j = new Web3jService(cfg);
    const receipt = await web3j.sendRawTransaction(
      addr,
      pickFn(abi, 'createRecord'),
      [indexB32, recordB32],
      '_uploadRole'
    );
    if (!receiptOk(receipt)) {
      const out = getReceiptOutput(receipt);
      const reason = out ? decodeRevertReason(out) : null;
      const msg =
        reason === 'exists'
          ? 'case index already exists on CaseRegistry'
          : `createRecord failed (status ${receipt && receipt.status})`;
      const err = new Error(msg);
      err.code = reason === 'exists' ? 'DUPLICATE_CASE_REGISTRY' : 'CREATE_RECORD_FAILED';
      if (reason === 'exists') {
        err.status = 409;
      }
      err.receipt = receipt;
      throw err;
    }
    const txHash = receipt.transactionHash;
    if (!txHash || typeof txHash !== 'string') {
      throw new Error('createRecord receipt missing transactionHash');
    }
    const blockNumber =
      receipt.blockNumber != null ? parseReceiptBlockNumber(receipt.blockNumber) : 0;
    return { txHash, blockNumber };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = {
  createRecordFromUserKeystore,
  proposeFromUserKeystore,
  approveFromUserKeystore,
  rejectFromUserKeystore,
  executeFromUserKeystore,
  executeAsExecutor,
  getRecordHashOnRegistry,
  getProposalFromRegistry,
  toBytes32,
  pickFn,
  STATUS_NAMES
};
