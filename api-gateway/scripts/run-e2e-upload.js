'use strict';

/**
 * One-off: same logic as POST /api/upload for u-police-1, without X-Auth-Token (fresh process).
 *
 * Usage (from api-gateway): node scripts/run-e2e-upload.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'run-e2e-upload-placeholder';
}
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/services/recordStore')];

const config = require('../src/config');
const integrity = require('../src/services/integrity');
const hashOnly = require('../src/services/hashOnly');
const chain = require('../src/services/chain');
const { getDefaultRecordStore } = require('../src/services/recordStore');

const userId = process.env.POLICE_USER_ID || 'u-police-1';

function toHex0x(hexMaybe) {
  const s = String(hexMaybe).trim().replace(/^0x/i, '');
  return `0x${s.toLowerCase()}`;
}

async function main() {
  const root = path.join(__dirname, '..');
  const bodyPath = path.join(root, 'e2e-upload-body.json');
  if (!fs.existsSync(bodyPath)) {
    console.error('Missing e2e-upload-body.json — run: node scripts/gen-e2e-upload-body.js');
    process.exit(1);
  }
  const body = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
  const {
    caseId: caseIdRaw,
    examiner,
    aggregateHash,
    generatedAt,
    caseJson,
    signingPassword
  } = body;

  if (typeof caseJson !== 'string' || !caseJson.trim()) {
    throw new Error('caseJson required');
  }

  const contractMode = config.uploadContractEnabled();
  if (contractMode && (signingPassword == null || String(signingPassword) === '')) {
    throw new Error('signingPassword required for contract upload');
  }

  if (!integrity.verify(caseJson)) {
    throw new Error('aggregate hash verification failed');
  }

  const caseId = String(caseIdRaw).trim();
  const ex = String(examiner);
  const agg = String(aggregateHash);
  const gen = String(generatedAt);

  const indexHashRaw = hashOnly.computeIndexHash(caseId);
  const recordHashRaw = hashOnly.computeRecordHash(caseId, caseJson, agg, ex, gen);

  const recordStore = getDefaultRecordStore();
  recordStore.save(caseId, caseJson, agg, ex, gen);

  const { txHash, blockNumber } = await chain.insertRecord({
    indexHash: indexHashRaw,
    recordHash: recordHashRaw
  });

  recordStore.mergeFields(caseId, {
    crud_tx_hash: txHash,
    crud_block_number: blockNumber
  });

  let caseRegistryTxHash;
  let caseRegistryBlockNumber;
  if (contractMode) {
    const reg = await chain.createCaseRegistryRecordFromKeystore({
      userId,
      signingPassword: String(signingPassword),
      indexHashHex: indexHashRaw,
      recordHashHex: recordHashRaw
    });
    caseRegistryTxHash = reg.txHash;
    caseRegistryBlockNumber = reg.blockNumber;
    recordStore.mergeFields(caseId, {
      case_registry_tx_hash: caseRegistryTxHash,
      case_registry_block_number: caseRegistryBlockNumber
    });
  }

  const out = {
    caseId,
    indexHash: toHex0x(indexHashRaw),
    recordHash: toHex0x(recordHashRaw),
    txHash,
    blockNumber,
    ...(caseRegistryTxHash != null
      ? { caseRegistryTxHash, caseRegistryBlockNumber }
      : {})
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
