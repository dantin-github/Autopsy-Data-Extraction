'use strict';

/**
 * One-off: same logic as POST /api/modify/propose for officer1 (u-police-1), fresh process
 * so data/users.json is re-read (avoids stale userStore cache in a long-running dev server).
 *
 * Usage (from api-gateway): node scripts/run-e2e-propose.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'run-e2e-propose-placeholder';
}
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/services/recordStore')];

const config = require('../src/config');
const integrity = require('../src/services/integrity');
const hashOnly = require('../src/services/hashOnly');
const caseRegistryTx = require('../src/services/caseRegistryTx');
const { getDefaultRecordStore } = require('../src/services/recordStore');

const userId = process.env.POLICE_USER_ID || 'u-police-1';

function toHex0x(hexMaybe) {
  const s = String(hexMaybe).trim().replace(/^0x/i, '');
  return `0x${s.toLowerCase()}`;
}

function hexEqLo(a, b) {
  const na = String(a || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  const nb = String(b || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  return na.length > 0 && na === nb;
}

function pendingStorageKey(caseId, proposalId) {
  const pid = String(proposalId).trim().toLowerCase();
  return `${String(caseId).trim()}::pending-${pid}`;
}

async function main() {
  const root = path.join(__dirname, '..');
  const bodyPath = path.join(root, 'e2e-propose-body.json');
  if (!fs.existsSync(bodyPath)) {
    console.error('Missing e2e-propose-body.json');
    process.exit(1);
  }
  const body = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
  const {
    caseId: caseIdRaw,
    caseJson,
    aggregateHash,
    examiner,
    generatedAt,
    signingPassword,
    reason
  } = body;

  if (!String(config.caseRegistryAddr || '').trim()) {
    throw new Error('CASE_REGISTRY_ADDR is not configured');
  }
  if (!integrity.verify(caseJson)) {
    throw new Error('aggregate hash verification failed');
  }

  const caseId = String(caseIdRaw).trim();
  const recordStore = getDefaultRecordStore();
  const existing = recordStore.get(caseId);
  if (existing == null) {
    throw new Error(`case not in record store: ${caseId}`);
  }

  let proposalIdHex = `0x${crypto.randomBytes(32).toString('hex')}`;

  const indexHashRaw = hashOnly.computeIndexHash(caseId);
  const newRecordHashRaw = hashOnly.computeRecordHash(
    caseId,
    caseJson,
    String(aggregateHash),
    String(examiner),
    String(generatedAt)
  );

  const chainOldHex = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
  if (chainOldHex == null) {
    throw new Error('no CaseRegistry record for this case');
  }

  const localOldHex = toHex0x(hashOnly.computeRecordHashFromJson(existing));
  if (!hexEqLo(chainOldHex, localOldHex)) {
    throw new Error('local record hash does not match CaseRegistry');
  }

  const newFull = JSON.stringify({
    case_id: caseId,
    case_json: String(caseJson),
    aggregate_hash: String(aggregateHash),
    examiner: String(examiner),
    created_at: String(generatedAt)
  });

  const { txHash, blockNumber, proposalCreated } = await caseRegistryTx.proposeFromUserKeystore({
    userId,
    signingPassword: String(signingPassword),
    proposalIdHex,
    indexHashHex: indexHashRaw,
    oldRecordHashHex: chainOldHex.replace(/^0x/i, ''),
    newRecordHashHex: newRecordHashRaw,
    reason: reason != null ? String(reason) : ''
  });

  const pkey = pendingStorageKey(caseId, proposalIdHex);
  recordStore.save(pkey, newFull);

  const out = {
    proposalId: proposalIdHex,
    caseId,
    txHash,
    blockNumber,
    indexHash: toHex0x(indexHashRaw),
    oldRecordHash: chainOldHex,
    newRecordHash: toHex0x(newRecordHashRaw),
    pendingKey: pkey
  };
  if (proposalCreated) {
    out.proposalCreated = proposalCreated;
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
