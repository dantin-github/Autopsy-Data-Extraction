'use strict';

const express = require('express');
const config = require('../config');
const integrity = require('../services/integrity');
const hashOnly = require('../services/hashOnly');
const { getDefaultRecordStore } = require('../services/recordStore');
const chain = require('../services/chain');
const caseRegistryTx = require('../services/caseRegistryTx');
const requirePoliceToken = require('../middleware/requirePoliceToken');

const router = express.Router();

function toHex0x(hexMaybe) {
  const s = String(hexMaybe).trim().replace(/^0x/i, '');
  return `0x${s.toLowerCase()}`;
}

/**
 * POST /api/upload — police + one-time OTP (X-Auth-Token).
 * Body: caseId, examiner, aggregateHash, generatedAt, caseJson (string: full Autopsy export JSON).
 */
router.post('/api/upload', requirePoliceToken, async (req, res, next) => {
  const body = req.body || {};
  const caseIdRaw = body.caseId;
  const examiner = body.examiner;
  const aggregateHash = body.aggregateHash;
  const generatedAt = body.generatedAt;
  const caseJson = body.caseJson;

  if (caseIdRaw == null || String(caseIdRaw).trim() === '') {
    const err = new Error('caseId is required');
    err.status = 400;
    return next(err);
  }
  if (examiner == null || String(examiner).trim() === '') {
    const err = new Error('examiner is required');
    err.status = 400;
    return next(err);
  }
  if (aggregateHash == null || String(aggregateHash).trim() === '') {
    const err = new Error('aggregateHash is required');
    err.status = 400;
    return next(err);
  }
  if (generatedAt == null || String(generatedAt).trim() === '') {
    const err = new Error('generatedAt is required');
    err.status = 400;
    return next(err);
  }
  if (typeof caseJson !== 'string' || caseJson.trim() === '') {
    const err = new Error('caseJson must be a non-empty string (full case JSON)');
    err.status = 400;
    return next(err);
  }

  const contractMode =
    config.uploadUseCaseRegistry && String(config.caseRegistryAddr || '').trim() !== '';
  if (contractMode) {
    const sp = body.signingPassword;
    if (sp == null || String(sp) === '') {
      const err = new Error(
        'signingPassword is required when UPLOAD_USE_CASE_REGISTRY is enabled and CASE_REGISTRY_ADDR is set'
      );
      err.status = 400;
      return next(err);
    }
  }

  if (!integrity.verify(caseJson)) {
    const err = new Error('aggregate hash verification failed');
    err.status = 400;
    return next(err);
  }

  const caseId = String(caseIdRaw).trim();
  const ex = String(examiner);
  const agg = String(aggregateHash);
  const gen = String(generatedAt);

  const indexHashRaw = hashOnly.computeIndexHash(caseId);
  const recordHashRaw = hashOnly.computeRecordHash(caseId, caseJson, agg, ex, gen);

  const recordStore = getDefaultRecordStore();

  try {
    recordStore.save(caseId, caseJson, agg, ex, gen);
  } catch (e) {
    return next(e);
  }

  try {
    const { txHash, blockNumber } = await chain.insertRecord({
      indexHash: indexHashRaw,
      recordHash: recordHashRaw
    });

    let caseRegistryTxHash;
    let caseRegistryBlockNumber;
    if (contractMode) {
      try {
        const reg = await caseRegistryTx.createRecordFromUserKeystore({
          userId: req.policeUserId,
          signingPassword: String(body.signingPassword || ''),
          indexHashHex: indexHashRaw,
          recordHashHex: recordHashRaw
        });
        caseRegistryTxHash = reg.txHash;
        caseRegistryBlockNumber = reg.blockNumber;
      } catch (e) {
        try {
          recordStore.remove(caseId);
        } catch (_) {
          /* best-effort rollback */
        }
        if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
          e.status = 503;
        } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
          e.status = 503;
        } else if (e && e.code === 'CASE_REGISTRY_ADDR_MISSING') {
          e.status = 503;
        } else if (e && e.code === 'NOT_POLICE') {
          e.status = 403;
        } else if (e && e.status) {
          /* keep */
        } else if (e && e.code === 'DUPLICATE_CASE_REGISTRY') {
          e.status = 409;
        } else if (e && /duplicate|exist|already|Duplicate/i.test(String(e.message))) {
          e.status = 409;
        }
        return next(e);
      }
    }

    return res.status(200).json({
      indexHash: toHex0x(indexHashRaw),
      recordHash: toHex0x(recordHashRaw),
      txHash,
      blockNumber,
      ...(caseRegistryTxHash != null
        ? { caseRegistryTxHash, caseRegistryBlockNumber }
        : {})
    });
  } catch (e) {
    try {
      recordStore.remove(caseId);
    } catch (_) {
      /* best-effort rollback */
    }
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && /duplicate|exist|already|Duplicate/i.test(String(e.message))) {
      e.status = 409;
    }
    return next(e);
  }
});

module.exports = router;
