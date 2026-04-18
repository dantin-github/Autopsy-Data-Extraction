'use strict';

/**
 * Decode a CRUD precompile insert() transaction by txHash: prints tableName, key field name,
 * and entry JSON fields (index_hash, record_hash) exactly as encoded on-chain.
 * Usage (from api-gateway): node scripts/decode-crud-insert-tx.js <0x...>
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'decode-crud-tx-placeholder';
}

const { ethers } = require('ethers');
const { Configuration, Web3jService } = require('fisco-bcos');
const constant = require('fisco-bcos/lib/precompiled/crud/constant');
const config = require('../src/config');

const CRUD_ADDR = constant.CRUD_PRECOMPILE_ADDRESS.toLowerCase();

function unwrapRpc(res) {
  if (res && res.result != null && typeof res.result === 'object' && !res.result.jsonrpc) {
    return res.result;
  }
  return res;
}

(async () => {
  const txHash = process.argv[2];
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    console.error('Usage: node scripts/decode-crud-insert-tx.js <txHash>');
    process.exit(1);
  }

  const w3 = new Web3jService(new Configuration(config.fiscoConfigPath));
  const raw = await w3.getTransactionByHash(txHash.trim());
  const tx = unwrapRpc(raw);

  if (!tx || tx == null) {
    console.error('getTransactionByHash returned empty (wrong hash or node?)');
    process.exit(1);
  }

  const to = (tx.to && String(tx.to).toLowerCase()) || '';
  if (to && to !== CRUD_ADDR) {
    console.error(`Transaction to=${tx.to} is not CRUD precompile ${constant.CRUD_PRECOMPILE_ADDRESS}`);
    process.exit(1);
  }

  let input = tx.input;
  if (input == null || input === '0x' || input === '') {
    console.error('Transaction has no input data');
    process.exit(1);
  }
  if (!String(input).startsWith('0x')) {
    input = `0x${input}`;
  }

  const iface = new ethers.utils.Interface([
    { ...constant.CRUD_PRECOMPILE_ABI.insert, type: 'function' }
  ]);
  const txData = tx.input != null ? tx.input : tx.data;
  if (!txData || txData.length < 10) {
    console.error('Transaction input/data too short');
    process.exit(1);
  }
  const parsed = iface.parseTransaction({ data: txData });
  if (!parsed || !parsed.args) {
    console.error('parseTransaction failed (not an insert() calldata?)');
    process.exit(1);
  }

  const tableName = parsed.args[0];
  const keyFieldName = parsed.args[1];
  const entryJson = parsed.args[2];
  const optional = parsed.args[3];

  let entry;
  try {
    entry = JSON.parse(entryJson);
  } catch (e) {
    console.error('entry JSON parse failed:', e.message || e);
    console.error('raw entry string:', entryJson);
    process.exit(1);
  }

  console.log('tableName:', tableName);
  console.log('keyField:', keyFieldName);
  console.log('optional:', optional || '(empty)');
  console.log('entry.index_hash:', entry.index_hash);
  console.log('entry.record_hash:', entry.record_hash);
  console.log('');
  console.log('Console (copy index_hash value only, one line):');
  console.log(
    `select * from ${tableName} where ${keyFieldName} = '${String(entry.index_hash).replace(/'/g, "''")}'`
  );
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
