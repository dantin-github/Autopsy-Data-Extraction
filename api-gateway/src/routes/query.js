'use strict';

const express = require('express');
const hashOnly = require('../services/hashOnly');
const integrity = require('../services/integrity');
const { getDefaultRecordStore } = require('../services/recordStore');
const chain = require('../services/chain');
const requireJudgeSession = require('../middleware/requireJudgeSession');

const router = express.Router();

function toHex0x(hexMaybe) {
  const s = String(hexMaybe).trim().replace(/^0x/i, '');
  return `0x${s.toLowerCase()}`;
}

function hexEq(a, b) {
  const na = String(a || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  const nb = String(b || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  return na.length > 0 && nb.length > 0 && na === nb;
}

/**
 * POST /api/query — judge session: load local record, recompute hashes, verify aggregate on
 * case_json, compare local record_hash to chain (t_case_hash). Response shape aligned with
 * api_gateway_dev_plan §4.3 / S3.5.
 */
router.post('/api/query', requireJudgeSession, async (req, res, next) => {
  const body = req.body || {};
  const caseIdRaw = body.caseId;
  if (caseIdRaw == null || String(caseIdRaw).trim() === '') {
    const err = new Error('caseId is required');
    err.status = 400;
    return next(err);
  }
  const caseId = String(caseIdRaw).trim();

  const recordStore = getDefaultRecordStore();
  let fullRecordJson;
  let recordObj;
  try {
    const raw = recordStore.get(caseId);
    if (raw == null) {
      return res.status(404).json({ error: 'case not found in local store' });
    }
    fullRecordJson = raw;
    recordObj = JSON.parse(fullRecordJson);
  } catch {
    const err = new Error('stored record is invalid JSON');
    err.status = 400;
    return next(err);
  }

  let recordHashRaw;
  try {
    recordHashRaw = hashOnly.computeRecordHashFromJson(fullRecordJson);
  } catch {
    const err = new Error('stored record has invalid shape for hash');
    err.status = 400;
    return next(err);
  }

  const caseJsonInner =
    recordObj && recordObj.case_json != null ? String(recordObj.case_json) : '';
  const aggregateHashValid =
    caseJsonInner !== '' ? integrity.verify(caseJsonInner) : false;

  const indexHashRaw = hashOnly.computeIndexHash(caseId);

  try {
    /** Canonical on-chain row for this case (indexed by `index_hash`), including S3.6 tamper compare. */
    const selIdx = await chain.selectRecordByIndexHash(indexHashRaw);
    const chainRh = selIdx.recordHash != null ? String(selIdx.recordHash) : null;
    const localRecordHex = toHex0x(recordHashRaw);
    const recordHashMatch = Boolean(chainRh && hexEq(chainRh, localRecordHex));

    const chainOut = {
      indexHash: toHex0x(indexHashRaw),
      recordHash: chainRh
    };
    const crudTxRaw =
      recordObj && recordObj.crud_tx_hash != null
        ? String(recordObj.crud_tx_hash).trim()
        : '';
    if (crudTxRaw !== '') {
      chainOut.txHash = toHex0x(crudTxRaw.replace(/^0x/i, ''));
    }
    const regTxRaw =
      recordObj && recordObj.case_registry_tx_hash != null
        ? String(recordObj.case_registry_tx_hash).trim()
        : '';
    if (regTxRaw !== '') {
      chainOut.caseRegistryTxHash = toHex0x(regTxRaw.replace(/^0x/i, ''));
    }

    return res.status(200).json({
      caseId,
      chain: chainOut,
      record: recordObj,
      integrity: {
        recordHashMatch,
        aggregateHashValid,
        recordHashLocal: localRecordHex,
        recordHashOnChain: chainRh
      }
    });
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    }
    return next(e);
  }
});

module.exports = router;
