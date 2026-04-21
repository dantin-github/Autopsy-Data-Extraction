'use strict';

/**
 * FISCO BCOS via Node SDK: block height + CRUD on `t_case_hash` (S3.2 / S3.3).
 */

const fs = require('fs');
const path = require('path');
const { Configuration, Web3jService, CRUDService, Table, Entry, Condition } = require('fisco-bcos');
const { handleReceipt } = require('fisco-bcos/lib/precompiled/common');
const crudConstant = require('fisco-bcos/lib/precompiled/crud/constant');
const config = require('../config');

let _cachedConfiguration = null;
let _web3jService = null;
let _crudService = null;

function gatewayPemPath() {
  return path.join(path.dirname(config.fiscoConfigPath), 'accounts', 'gateway.pem');
}

function isChainConfigured() {
  return fs.existsSync(config.fiscoConfigPath) && fs.existsSync(gatewayPemPath());
}

/** Human-readable list of missing paths (empty if ready). */
function getChainConfigGaps() {
  const gaps = [];
  if (!fs.existsSync(config.fiscoConfigPath)) {
    gaps.push(
      `fisco config missing: ${config.fiscoConfigPath} → run: npm run copy-chain-certs`
    );
  }
  const pem = gatewayPemPath();
  if (!fs.existsSync(pem)) {
    gaps.push(
      `signing account PEM missing: ${pem} → copy from FISCO console (e.g. console/account/0x*.pem) and save as gateway.pem`
    );
  }
  return gaps;
}

function getCachedConfiguration() {
  if (!_cachedConfiguration) {
    _cachedConfiguration = new Configuration(config.fiscoConfigPath);
  }
  return _cachedConfiguration;
}

function getWeb3jService() {
  if (!_web3jService) {
    _web3jService = new Web3jService(getCachedConfiguration());
  }
  return _web3jService;
}

function getCrudService() {
  if (!_crudService) {
    _crudService = new CRUDService(getCachedConfiguration());
  }
  return _crudService;
}

/** Normalize to `0x` + lowercase hex (FISCO CRUD entry fields are strings). */
function normalizeChainHashHex(name, value) {
  if (value == null) {
    throw new Error(`${name} is required`);
  }
  let s = String(value).trim();
  if (s === '') {
    throw new Error(`${name} must be non-empty`);
  }
  if (s.startsWith('0x') || s.startsWith('0X')) {
    s = s.slice(2);
  }
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error(`${name} must be an even-length hex string (with or without 0x)`);
  }
  return `0x${s.toLowerCase()}`;
}

/**
 * Same rules as {@link normalizeChainHashHex} but returns null for bad/empty values
 * (FISCO CRUD rows occasionally return malformed strings — callers should skip the row).
 * @param {unknown} value
 * @returns {string | null}
 */
function tryNormalizeChainHashHex(value) {
  if (value == null) {
    return null;
  }
  let s = String(value).trim();
  if (s === '') {
    return null;
  }
  if (s.startsWith('0x') || s.startsWith('0X')) {
    s = s.slice(2);
  }
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    return null;
  }
  return `0x${s.toLowerCase()}`;
}

/**
 * Insert one row into `t_case_hash` (primary key `index_hash`, value `record_hash`).
 * Returns the transaction hash from the Channel receipt (SDK `insert()` alone does not expose it).
 *
 * @param {{ indexHash: string, recordHash: string }} row
 * @returns {{ txHash: string, affected: number, blockNumber: number }}
 */
async function insertRecord(row) {
  if (!isChainConfigured()) {
    const detail = getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const indexHash = normalizeChainHashHex('indexHash', row && row.indexHash);
  const recordHash = normalizeChainHashHex('recordHash', row && row.recordHash);

  const table = new Table(config.caseHashTableName, 'index_hash', 'record_hash');
  const entry = new Entry();
  entry.put('index_hash', indexHash);
  entry.put('record_hash', recordHash);

  const parameters = [
    table.tableName,
    table.key,
    JSON.stringify(entry.fields),
    table.optional
  ];

  const receipt = await getWeb3jService().sendRawTransaction(
    crudConstant.CRUD_PRECOMPILE_ADDRESS,
    crudConstant.CRUD_PRECOMPILE_ABI.insert,
    parameters
  );

  const txHash = receipt.transactionHash;
  if (!txHash || typeof txHash !== 'string') {
    throw new Error('sendRawTransaction receipt missing transactionHash');
  }

  const decoded = handleReceipt(receipt, crudConstant.CRUD_PRECOMPILE_ABI.insert);
  const affected = parseInt(String(decoded[0]), 10);
  const blockNumber = parseInt(receipt.blockNumber, 16);

  return { txHash, affected, blockNumber };
}

/**
 * Update `record_hash` for an existing `index_hash` row in `t_case_hash` (CRUD precompile).
 *
 * @param {{ indexHash: string, recordHash: string }} row
 * @returns {{ txHash: string, affected: number, blockNumber: number }}
 */
async function updateRecord(row) {
  if (!isChainConfigured()) {
    const detail = getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const indexHash = normalizeChainHashHex('indexHash', row && row.indexHash);
  const recordHash = normalizeChainHashHex('recordHash', row && row.recordHash);

  const table = new Table(config.caseHashTableName, 'index_hash', 'record_hash');
  const entry = new Entry();
  entry.put('record_hash', recordHash);
  const condition = new Condition();
  condition.eq('index_hash', indexHash);

  const parameters = [
    table.tableName,
    table.key,
    JSON.stringify(entry.fields),
    JSON.stringify(condition.conditions),
    table.optional
  ];

  const receipt = await getWeb3jService().sendRawTransaction(
    crudConstant.CRUD_PRECOMPILE_ADDRESS,
    crudConstant.CRUD_PRECOMPILE_ABI.update,
    parameters
  );

  const txHash = receipt.transactionHash;
  if (!txHash || typeof txHash !== 'string') {
    throw new Error('sendRawTransaction receipt missing transactionHash');
  }

  const decoded = handleReceipt(receipt, crudConstant.CRUD_PRECOMPILE_ABI.update);
  const affected = parseInt(String(decoded[0]), 10);
  const blockNumber = parseInt(receipt.blockNumber, 16);

  return { txHash, affected, blockNumber };
}

/**
 * Select by `record_hash` (value column). On FISCO BCOS 2.x, `Condition.eq` on the
 * primary key field is not applied reliably for `select`; filtering on `record_hash`
 * returns a single row as expected. Callers that only have `index_hash` should compute
 * `record_hash` from the private store / canonical record first, then query here for
 * the on-chain copy (see Phase 3 query route).
 *
 * @param {string} recordHash
 * @returns {{ recordHash: string | null, rows: object[] }}
 */
async function selectRecord(recordHash) {
  if (!isChainConfigured()) {
    const detail = getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const rhKey = normalizeChainHashHex('recordHash', recordHash);

  const table = new Table(config.caseHashTableName, 'index_hash', 'record_hash');
  const condition = new Condition();
  condition.eq('record_hash', rhKey);

  const rows = await getCrudService().select(table, condition);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { recordHash: null, rows: [] };
  }
  const rh =
    rows[0] && rows[0].record_hash != null ? String(rows[0].record_hash) : null;
  return { recordHash: rh, rows };
}

/**
 * Select the row for `index_hash` (primary key). Used by /api/query to read the canonical
 * on-chain `record_hash` for a case, including when the local private store was tampered
 * (local record_hash no longer matches) — S3.6.
 *
 * @param {string} indexHash hex (with or without 0x)
 * @returns {{ indexHash: string | null, recordHash: string | null, rows: object[] }}
 */
async function selectRecordByIndexHash(indexHash) {
  if (!isChainConfigured()) {
    const detail = getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const ihKey = normalizeChainHashHex('indexHash', indexHash);

  const table = new Table(config.caseHashTableName, 'index_hash', 'record_hash');
  const condition = new Condition();
  condition.eq('index_hash', ihKey);

  const rows = await getCrudService().select(table, condition);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { indexHash: null, recordHash: null, rows: [] };
  }
  const idx =
    rows[0] && rows[0].index_hash != null ? String(rows[0].index_hash) : null;
  const rh =
    rows[0] && rows[0].record_hash != null ? String(rows[0].record_hash) : null;
  return { indexHash: idx, recordHash: rh, rows };
}

/**
 * Reliable read of `record_hash` for a case index. FISCO 2.x CRUD `select` with
 * `Condition.eq` on the primary key is not always trustworthy; we only accept a row
 * whose `index_hash` matches, otherwise fall back to `select` by `record_hash`
 * (value column), which is reliable per team notes in `selectRecord` above.
 *
 * @param {string} indexHashRaw
 * @param {string | null | undefined} recordHashCanonicalHex `0x`+64 preferred; registry hash if set, else local
 * @returns {Promise<string|null>} normalized `0x`+64 lowercase or null
 */
async function getMirroredRecordHash(indexHashRaw, recordHashCanonicalHex) {
  const { selectRecordByIndexHash: byIndex, selectRecord: byRecordHash } = module.exports;
  const wantIdx = normalizeChainHashHex('indexHash', indexHashRaw);
  const selIdx = await byIndex(indexHashRaw);
  for (const row of selIdx.rows || []) {
    if (!row) {
      continue;
    }
    const rowIdx = tryNormalizeChainHashHex(row.index_hash);
    if (rowIdx == null || rowIdx !== wantIdx) {
      continue;
    }
    const rowRh = tryNormalizeChainHashHex(row.record_hash);
    if (rowRh == null) {
      continue;
    }
    return rowRh;
  }

  const hint = recordHashCanonicalHex;
  if (hint == null || String(hint).trim() === '') {
    return null;
  }
  const selVal = await byRecordHash(hint);
  for (const row of selVal.rows || []) {
    if (!row) {
      continue;
    }
    const rowIdx = tryNormalizeChainHashHex(row.index_hash);
    if (rowIdx == null || rowIdx !== wantIdx) {
      continue;
    }
    const rowRh = tryNormalizeChainHashHex(row.record_hash);
    if (rowRh == null) {
      continue;
    }
    return rowRh;
  }
  return null;
}

/**
 * CaseRegistry.createRecord via police user keystore (S5.4 / S6.1). Lazy-loads `caseRegistryTx` to avoid circular require with that module.
 *
 * @param {{ userId: string, signingPassword: string, indexHashHex: string, recordHashHex: string }} opts
 * @returns {Promise<{ txHash: string, blockNumber: number }>}
 */
async function createCaseRegistryRecordFromKeystore(opts) {
  const caseRegistryTx = require('./caseRegistryTx');
  return caseRegistryTx.createRecordFromUserKeystore(opts);
}

/**
 * Current block height (group). Requires conf/fisco-config.json + conf/accounts/gateway.pem.
 */
async function getBlockNumber() {
  if (!isChainConfigured()) {
    const detail = getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.code = 'CHAIN_NOT_CONFIGURED';
    throw err;
  }
  const res = await getWeb3jService().getBlockNumber();
  return parseInt(res.result, 16);
}

module.exports = {
  gatewayPemPath,
  isChainConfigured,
  getChainConfigGaps,
  getBlockNumber,
  getWeb3jService,
  insertRecord,
  updateRecord,
  createCaseRegistryRecordFromKeystore,
  selectRecord,
  selectRecordByIndexHash,
  getMirroredRecordHash
};
