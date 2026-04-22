'use strict';

const express = require('express');
const config = require('../config');
const hashOnly = require('../services/hashOnly');
const integrity = require('../services/integrity');
const { getDefaultRecordStore } = require('../services/recordStore');
const chain = require('../services/chain');
const caseRegistryTx = require('../services/caseRegistryTx');
const requireJudgeSession = require('../middleware/requireJudgeSession');
const requirePoliceTokenOrAnySession = require('../middleware/requirePoliceTokenOrAnySession');

const router = express.Router();

/** Strip accidental ``caseId=…`` prefix from path or copy-paste. */
function normalizeCaseIdParam(raw) {
  let s = raw != null ? String(raw).trim() : '';
  if (s === '') {
    return '';
  }
  return s.replace(/^caseId\s*=\s*/i, '').trim();
}

/**
 * GET /api/case-exists/:caseId — police token or any session; CaseRegistry.getRecordHash for index(caseId).
 */
router.get('/api/case-exists/:caseId', requirePoliceTokenOrAnySession, async (req, res, next) => {
  const caseId = normalizeCaseIdParam(req.params.caseId);
  if (caseId === '') {
    const err = new Error('caseId is required');
    err.status = 400;
    return next(err);
  }

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    return next(err);
  }

  const indexHashRaw = hashOnly.computeIndexHash(caseId);

  try {
    const registryRh = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
    const exists = registryRh != null && String(registryRh).trim() !== '';
    return res.status(200).json({
      caseId,
      exists,
      indexHash: toHex0x(indexHashRaw),
      recordHash: exists ? String(registryRh).toLowerCase() : null
    });
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ADDR_MISSING') {
      e.status = 503;
    }
    return next(e);
  }
});

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
 * case_json, compare local record_hash to on-chain truth. When CASE_REGISTRY_ADDR is set,
 * CaseRegistry.getRecordHash is authoritative (same mapping updated by propose/execute);
 * t_case_hash (CRUD) is a mirror and may lag after execute if CRUD update fails — integrity
 * uses the registry first so judicial workflow does not produce false mismatch.
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
    const localRecordHex = toHex0x(recordHashRaw);

    let registryRh = null;
    const regAddr = String(config.caseRegistryAddr || '').trim();
    if (regAddr && /^0x[0-9a-fA-F]{40}$/i.test(regAddr)) {
      registryRh = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
    }

    const canonicalHint = registryRh || localRecordHex;
    const chainRh = await chain.getMirroredRecordHash(indexHashRaw, canonicalHint);

    /** Prefer CaseRegistry when configured and has a row — avoids false negative after execute. */
    const canonicalRh = registryRh || chainRh;
    const recordHashMatch = Boolean(canonicalRh && hexEq(canonicalRh, localRecordHex));
    const crudRegistryOutOfSync =
      registryRh != null &&
      chainRh != null &&
      !hexEq(registryRh, chainRh);

    const chainOut = {
      indexHash: toHex0x(indexHashRaw),
      recordHash: canonicalRh
    };
    if (chainRh != null && chainRh !== '') {
      chainOut.recordHashCrud = chainRh;
    }
    if (registryRh != null && registryRh !== '') {
      chainOut.recordHashRegistry = registryRh;
    }
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
        recordHashOnChain: canonicalRh,
        recordHashOnChainCrud: chainRh,
        recordHashOnChainRegistry: registryRh,
        crudRegistryOutOfSync
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
