'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const integrity = require('../services/integrity');
const hashOnly = require('../services/hashOnly');
const { getDefaultRecordStore } = require('../services/recordStore');
const chain = require('../services/chain');
const caseRegistryTx = require('../services/caseRegistryTx');
const userStore = require('../services/userStore');
const requirePoliceToken = require('../middleware/requirePoliceToken');
const { logger } = require('../logger');

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

function uploadTimingEnabled(req) {
  const raw = req.get('X-Debug-Timing');
  if (raw === '1' || String(raw).toLowerCase() === 'true') {
    return true;
  }
  return Boolean(config.uploadTimingInResponse);
}

/**
 * POST /api/upload — police + one-time OTP (X-Auth-Token).
 * Body: caseId, examiner, aggregateHash, generatedAt, caseJson (string: full Autopsy export JSON).
 */
router.post('/api/upload', requirePoliceToken, async (req, res, next) => {
  if (config.nodeEnv === 'development') {
    userStore.clearCache();
  }
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

  const contractMode = config.uploadContractEnabled();
  if (contractMode) {
    const sp = body.signingPassword;
    if (sp == null || String(sp) === '') {
      const err = new Error(
        'signingPassword is required when CHAIN_MODE=contract (or UPLOAD_USE_CASE_REGISTRY=1) and CASE_REGISTRY_ADDR is set'
      );
      err.status = 400;
      return next(err);
    }
  }

  const timingEnabled = uploadTimingEnabled(req);
  const requestId = timingEnabled ? crypto.randomUUID() : null;
  const tStart = timingEnabled ? Date.now() : null;

  const tIntegrity0 = timingEnabled ? Date.now() : null;
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

  const integrityMs = timingEnabled && tIntegrity0 != null ? Date.now() - tIntegrity0 : 0;

  try {
    const tChain0 = timingEnabled ? Date.now() : null;
    const { txHash, blockNumber } = await chain.insertRecord({
      indexHash: indexHashRaw,
      recordHash: recordHashRaw
    });
    const chainMs = timingEnabled && tChain0 != null ? Date.now() - tChain0 : 0;

    try {
      recordStore.mergeFields(caseId, {
        crud_tx_hash: txHash,
        crud_block_number: blockNumber
      });
    } catch (e) {
      try {
        recordStore.remove(caseId);
      } catch (_) {
        /* best-effort rollback */
      }
      return next(e);
    }

    let caseRegistryTxHash;
    let caseRegistryBlockNumber;
    let caseRegistryMs = 0;
    if (contractMode) {
      try {
        const tReg0 = timingEnabled ? Date.now() : null;
        const reg = await chain.createCaseRegistryRecordFromKeystore({
          userId: req.policeUserId,
          signingPassword: String(body.signingPassword || ''),
          indexHashHex: indexHashRaw,
          recordHashHex: recordHashRaw
        });
        if (timingEnabled && tReg0 != null) {
          caseRegistryMs = Date.now() - tReg0;
        }
        caseRegistryTxHash = reg.txHash;
        caseRegistryBlockNumber = reg.blockNumber;
        try {
          recordStore.mergeFields(caseId, {
            case_registry_tx_hash: caseRegistryTxHash,
            case_registry_block_number: caseRegistryBlockNumber
          });
        } catch (mergeErr) {
          try {
            recordStore.remove(caseId);
          } catch (_) {
            /* best-effort rollback */
          }
          return next(mergeErr);
        }
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

    if (contractMode && caseRegistryTxHash) {
      try {
        const regRh = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
        const crudRh = await chain.getMirroredRecordHash(
          indexHashRaw,
          regRh || toHex0x(recordHashRaw)
        );
        if (regRh && crudRh && !hexEq(regRh, crudRh)) {
          logger.warn(
            { caseId, indexHash: indexHashRaw },
            'upload: CRUD record_hash differs from CaseRegistry; aligning CRUD to Registry'
          );
          await chain.updateRecord({ indexHash: indexHashRaw, recordHash: regRh });
        }
      } catch (reconErr) {
        logger.warn(
          { err: reconErr && reconErr.message, caseId },
          'upload: post-upload CRUD/Registry reconcile failed'
        );
      }
    }

    let blockTimestampUtc = null;
    if (timingEnabled && blockNumber != null) {
      try {
        blockTimestampUtc = await chain.getBlockTimestampUtcIso(blockNumber);
      } catch (tsErr) {
        logger.warn(
          { err: tsErr && tsErr.message, caseId, blockNumber },
          'upload: block timestamp lookup failed'
        );
      }
    }

    const totalMs = timingEnabled && tStart != null ? Date.now() - tStart : 0;
    const basePayload = {
      indexHash: toHex0x(indexHashRaw),
      recordHash: toHex0x(recordHashRaw),
      txHash,
      blockNumber,
      ...(caseRegistryTxHash != null
        ? { caseRegistryTxHash, caseRegistryBlockNumber }
        : {})
    };

    if (timingEnabled && requestId) {
      const timing = {
        integrityMs,
        chainMs,
        totalMs,
        ...(contractMode ? { caseRegistryMs } : {})
      };
      logger.info(
        { requestId, caseId, timing, blockTimestampUtc },
        'upload_timing'
      );
      return res.status(200).json({
        ...basePayload,
        requestId,
        timing,
        ...(blockTimestampUtc ? { blockTimestampUtc } : {})
      });
    }

    return res.status(200).json(basePayload);
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
