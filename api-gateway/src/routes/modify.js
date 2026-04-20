'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const hashOnly = require('../services/hashOnly');
const integrity = require('../services/integrity');
const chain = require('../services/chain');
const { getDefaultRecordStore } = require('../services/recordStore');
const caseRegistryTx = require('../services/caseRegistryTx');
const requirePoliceSession = require('../middleware/requirePoliceSession');
const requireJudgeSession = require('../middleware/requireJudgeSession');
const requireAnySession = require('../middleware/requireAnySession');

const router = express.Router();

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

/** @returns {{ caseId: string, pendingKey: string }|null} */
function findPendingEntryForProposal(recordStore, proposalIdHex) {
  const s = String(proposalIdHex).replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    return null;
  }
  const pid = `0x${s.toLowerCase()}`;
  const needle = `::pending-${pid}`;
  for (const k of recordStore.keys()) {
    const idx = k.indexOf('::pending-');
    if (idx === -1) {
      continue;
    }
    if (k.slice(idx) === needle) {
      return { caseId: k.slice(0, idx), pendingKey: k };
    }
  }
  return null;
}

/**
 * POST /api/modify/propose — police session + keystore signing; chain `propose`; pending JSON in recordStore (S7.1).
 */
router.post('/api/modify/propose', requirePoliceSession, async (req, res, next) => {
  const body = req.body || {};
  const caseIdRaw = body.caseId;
  const caseJson = body.caseJson;
  const aggregateHash = body.aggregateHash;
  const examiner = body.examiner;
  const generatedAt = body.generatedAt;
  const signingPassword = body.signingPassword;
  const reason = body.reason != null ? String(body.reason) : '';
  let proposalIdHex = body.proposalId != null ? String(body.proposalId).trim() : '';

  if (caseIdRaw == null || String(caseIdRaw).trim() === '') {
    const err = new Error('caseId is required');
    err.status = 400;
    return next(err);
  }
  if (typeof caseJson !== 'string' || caseJson.trim() === '') {
    const err = new Error('caseJson must be a non-empty string');
    err.status = 400;
    return next(err);
  }
  if (aggregateHash == null || String(aggregateHash).trim() === '') {
    const err = new Error('aggregateHash is required');
    err.status = 400;
    return next(err);
  }
  if (examiner == null || String(examiner).trim() === '') {
    const err = new Error('examiner is required');
    err.status = 400;
    return next(err);
  }
  if (generatedAt == null || String(generatedAt).trim() === '') {
    const err = new Error('generatedAt is required');
    err.status = 400;
    return next(err);
  }
  if (signingPassword == null || String(signingPassword) === '') {
    const err = new Error('signingPassword is required');
    err.status = 400;
    return next(err);
  }

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    return next(err);
  }

  if (!integrity.verify(caseJson)) {
    const err = new Error('aggregate hash verification failed');
    err.status = 400;
    return next(err);
  }

  const caseId = String(caseIdRaw).trim();
  const recordStore = getDefaultRecordStore();
  const existing = recordStore.get(caseId);
  if (existing == null) {
    const err = new Error('case not found in local store');
    err.status = 404;
    return next(err);
  }

  if (!proposalIdHex) {
    proposalIdHex = `0x${crypto.randomBytes(32).toString('hex')}`;
  } else {
    const s = proposalIdHex.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(s)) {
      const err = new Error('proposalId must be 32 bytes hex (with or without 0x)');
      err.status = 400;
      return next(err);
    }
    proposalIdHex = `0x${s.toLowerCase()}`;
  }

  const indexHashRaw = hashOnly.computeIndexHash(caseId);
  const newRecordHashRaw = hashOnly.computeRecordHash(
    caseId,
    caseJson,
    String(aggregateHash),
    String(examiner),
    String(generatedAt)
  );

  let chainOldHex;
  try {
    chainOldHex = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    }
    return next(e);
  }

  if (chainOldHex == null) {
    const err = new Error(
      'no CaseRegistry record for this case — create one first (e.g. CHAIN_MODE=contract upload)'
    );
    err.status = 400;
    err.code = 'NO_CASE_REGISTRY_RECORD';
    return next(err);
  }

  const localOldHex = toHex0x(hashOnly.computeRecordHashFromJson(existing));
  if (!hexEqLo(chainOldHex, localOldHex)) {
    const err = new Error('local record hash does not match CaseRegistry (refresh or re-upload)');
    err.status = 409;
    err.code = 'OLD_HASH_MISMATCH';
    return next(err);
  }

  const newFull = JSON.stringify({
    case_id: caseId,
    case_json: String(caseJson),
    aggregate_hash: String(aggregateHash),
    examiner: String(examiner),
    created_at: String(generatedAt)
  });

  try {
    const { txHash, blockNumber, proposalCreated } = await caseRegistryTx.proposeFromUserKeystore({
      userId: req.policeUserId,
      signingPassword: String(signingPassword),
      proposalIdHex,
      indexHashHex: indexHashRaw,
      oldRecordHashHex: chainOldHex.replace(/^0x/i, ''),
      newRecordHashHex: newRecordHashRaw,
      reason
    });

    const pkey = pendingStorageKey(caseId, proposalIdHex);
    recordStore.save(pkey, newFull);

    const body = {
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
      body.proposalCreated = proposalCreated;
    }
    return res.status(200).json(body);
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
      e.status = 503;
    } else if (e && e.status) {
      /* keep */
    } else if (e && e.code === 'PROPOSE_FAILED' && e.status) {
      /* keep */
    }
    return next(e);
  }
});

/**
 * POST /api/modify/approve — judge session + keystore signing; chain `approve` (S7.2).
 */
router.post('/api/modify/approve', requireJudgeSession, async (req, res, next) => {
  const body = req.body || {};
  let proposalIdHex = body.proposalId != null ? String(body.proposalId).trim() : '';
  const signingPassword = body.signingPassword;

  if (!proposalIdHex) {
    const err = new Error('proposalId is required');
    err.status = 400;
    return next(err);
  }
  if (signingPassword == null || String(signingPassword) === '') {
    const err = new Error('signingPassword is required');
    err.status = 400;
    return next(err);
  }

  const s = proposalIdHex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    const err = new Error('proposalId must be 32 bytes hex (with or without 0x)');
    err.status = 400;
    return next(err);
  }
  proposalIdHex = `0x${s.toLowerCase()}`;

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    return next(err);
  }

  try {
    const { txHash, blockNumber, proposalApproved } = await caseRegistryTx.approveFromUserKeystore({
      userId: req.judgeUserId,
      signingPassword: String(signingPassword),
      proposalIdHex
    });
    const out = {
      proposalId: proposalIdHex,
      txHash,
      blockNumber
    };
    if (proposalApproved) {
      out.proposalApproved = proposalApproved;
    }
    return res.status(200).json(out);
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
      e.status = 503;
    } else if (e && e.status) {
      /* keep */
    } else if (e && e.code === 'APPROVE_FAILED' && e.status) {
      /* keep */
    }
    return next(e);
  }
});

/**
 * POST /api/modify/reject — judge session + keystore signing; chain `reject` (S7.3).
 */
router.post('/api/modify/reject', requireJudgeSession, async (req, res, next) => {
  const body = req.body || {};
  let proposalIdHex = body.proposalId != null ? String(body.proposalId).trim() : '';
  const signingPassword = body.signingPassword;
  const rejectReason = body.reason != null ? String(body.reason) : '';

  if (!proposalIdHex) {
    const err = new Error('proposalId is required');
    err.status = 400;
    return next(err);
  }
  if (signingPassword == null || String(signingPassword) === '') {
    const err = new Error('signingPassword is required');
    err.status = 400;
    return next(err);
  }
  if (rejectReason.trim() === '') {
    const err = new Error('reason is required');
    err.status = 400;
    return next(err);
  }

  const s = proposalIdHex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    const err = new Error('proposalId must be 32 bytes hex (with or without 0x)');
    err.status = 400;
    return next(err);
  }
  proposalIdHex = `0x${s.toLowerCase()}`;

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    return next(err);
  }

  try {
    const { txHash, blockNumber, proposalRejected } = await caseRegistryTx.rejectFromUserKeystore({
      userId: req.judgeUserId,
      signingPassword: String(signingPassword),
      proposalIdHex,
      rejectReason
    });
    const out = {
      proposalId: proposalIdHex,
      txHash,
      blockNumber,
      reason: rejectReason.trim()
    };
    if (proposalRejected) {
      out.proposalRejected = proposalRejected;
    }
    return res.status(200).json(out);
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
      e.status = 503;
    } else if (e && e.status) {
      /* keep */
    } else if (e && e.code === 'REJECT_FAILED' && e.status) {
      /* keep */
    }
    return next(e);
  }
});

/**
 * POST /api/modify/execute — police session + keystore signing; chain `execute`; apply pending snapshot to main case key (S7.4).
 */
router.post('/api/modify/execute', requirePoliceSession, async (req, res, next) => {
  const body = req.body || {};
  let proposalIdHex = body.proposalId != null ? String(body.proposalId).trim() : '';
  const signingPassword = body.signingPassword;

  if (!proposalIdHex) {
    const err = new Error('proposalId is required');
    err.status = 400;
    return next(err);
  }
  if (signingPassword == null || String(signingPassword) === '') {
    const err = new Error('signingPassword is required');
    err.status = 400;
    return next(err);
  }

  const s = proposalIdHex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    const err = new Error('proposalId must be 32 bytes hex (with or without 0x)');
    err.status = 400;
    return next(err);
  }
  proposalIdHex = `0x${s.toLowerCase()}`;

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    err.code = 'CASE_REGISTRY_ADDR_MISSING';
    return next(err);
  }

  const recordStore = getDefaultRecordStore();
  const pendingLoc = findPendingEntryForProposal(recordStore, proposalIdHex);
  if (!pendingLoc) {
    const err = new Error('no pending snapshot for this proposal in local store');
    err.status = 400;
    err.code = 'PENDING_SNAPSHOT_NOT_FOUND';
    return next(err);
  }

  const pendingFull = recordStore.get(pendingLoc.pendingKey);
  if (pendingFull == null) {
    const err = new Error('pending snapshot missing');
    err.status = 400;
    return next(err);
  }

  try {
    const { txHash, blockNumber, proposalExecuted } = await caseRegistryTx.executeFromUserKeystore({
      userId: req.policeUserId,
      signingPassword: String(signingPassword),
      proposalIdHex
    });

    recordStore.save(pendingLoc.caseId, pendingFull);
    recordStore.remove(pendingLoc.pendingKey);

    const indexHashRaw = hashOnly.computeIndexHash(pendingLoc.caseId);
    let newRecordHashRaw;
    try {
      newRecordHashRaw = hashOnly.computeRecordHashFromJson(pendingFull);
    } catch {
      newRecordHashRaw = null;
    }

    const out = {
      proposalId: proposalIdHex,
      caseId: pendingLoc.caseId,
      txHash,
      blockNumber,
      pendingKey: pendingLoc.pendingKey
    };
    if (proposalExecuted) {
      out.proposalExecuted = proposalExecuted;
    }

    if (newRecordHashRaw != null && chain.isChainConfigured()) {
      try {
        const crud = await chain.updateRecord({
          indexHash: indexHashRaw,
          recordHash: newRecordHashRaw
        });
        out.crudTxHash = crud.txHash;
        out.crudBlockNumber = crud.blockNumber;
      } catch (e) {
        out.crudUpdateWarning =
          't_case_hash row was not updated; CaseRegistry and local store already committed';
        out.crudUpdateError = e && e.message ? String(e.message) : 'unknown error';
      }
    }

    return res.status(200).json(out);
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ABI_MISSING') {
      e.status = 503;
    } else if (e && e.status) {
      /* keep */
    } else if (e && e.code === 'EXECUTE_FAILED' && e.status) {
      /* keep */
    }
    return next(e);
  }
});

/**
 * GET /api/modify/:proposalId — police or judge session; full on-chain proposal fields (S7.5).
 */
router.get('/api/modify/:proposalId', requireAnySession, async (req, res, next) => {
  let pid = req.params.proposalId != null ? String(req.params.proposalId).trim() : '';
  if (pid === '') {
    const err = new Error('proposalId is required');
    err.status = 400;
    return next(err);
  }
  const s = pid.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    const err = new Error('proposalId must be 32-byte hex');
    err.status = 400;
    return next(err);
  }
  pid = `0x${s.toLowerCase()}`;

  if (!String(config.caseRegistryAddr || '').trim()) {
    const err = new Error('CASE_REGISTRY_ADDR is not configured');
    err.status = 503;
    return next(err);
  }

  try {
    const p = await caseRegistryTx.getProposalFromRegistry(pid);
    if (p.status === 0 && /^0x0{64}$/i.test(String(p.indexHash || ''))) {
      return res.status(404).json({ error: 'proposal not found' });
    }
    return res.status(200).json({
      proposalId: pid,
      status: p.statusName,
      proposer: p.proposer,
      approver: p.approver,
      oldHash: p.oldRecordHash,
      newHash: p.newRecordHash,
      reason: p.reason,
      proposedAt: p.proposedAt,
      decidedAt: p.decidedAt
    });
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    }
    return next(e);
  }
});

module.exports = router;
