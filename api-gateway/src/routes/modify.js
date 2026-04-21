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
const { logger } = require('../logger');

const router = express.Router();

/** Delays before each CRUD update attempt (ms); first attempt is immediate. */
const CRUD_UPDATE_BACKOFF_MS = [0, 250, 750, 1500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort mirror of CaseRegistry into t_case_hash; transient RPC errors are retried (S4.8).
 * @param {string} indexHashRaw hex without 0x (from hashOnly.computeIndexHash)
 * @param {string} recordHashRaw 64 hex without 0x OR 0x + 64 hex (from computeRecordHashFromJson or registry)
 */
async function updateCrudMirrorWithRetries(indexHashRaw, recordHashRaw) {
  let lastErr;
  const max = CRUD_UPDATE_BACKOFF_MS.length;
  for (let i = 0; i < max; i += 1) {
    const waitMs = CRUD_UPDATE_BACKOFF_MS[i];
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    try {
      return await chain.updateRecord({
        indexHash: indexHashRaw,
        recordHash: recordHashRaw
      });
    } catch (e) {
      lastErr = e;
      logger.warn(
        {
          evt: 'crud_update_retry',
          attempt: i + 1,
          maxAttempts: max,
          err: e && e.message ? String(e.message) : String(e)
        },
        'CRUD updateRecord failed'
      );
    }
  }
  throw lastErr;
}

function toHex0x(hexMaybe) {
  const s = String(hexMaybe).trim().replace(/^0x/i, '');
  return `0x${s.toLowerCase()}`;
}

/** Strip accidental ``caseId=…`` prefix from path or copy-paste. */
function normalizeCaseIdParam(raw) {
  let s = raw != null ? String(raw).trim() : '';
  if (s === '') {
    return '';
  }
  return s.replace(/^caseId\s*=\s*/i, '').trim();
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

/** JSON shape for GET /api/modify/:proposalId and pending-for-case items. */
function proposalViewFromRegistry(p, pidNormalized) {
  return {
    proposalId: pidNormalized,
    status: p.statusName,
    proposer: p.proposer,
    approver: p.approver,
    oldHash: p.oldRecordHash,
    newHash: p.newRecordHash,
    reason: p.reason,
    proposedAt: p.proposedAt,
    decidedAt: p.decidedAt
  };
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
        const crud = await updateCrudMirrorWithRetries(indexHashRaw, newRecordHashRaw);
        out.crudTxHash = crud.txHash;
        out.crudBlockNumber = crud.blockNumber;
      } catch (e) {
        out.crudUpdateWarning =
          't_case_hash row was not updated after retries; CaseRegistry and local store already committed';
        out.crudUpdateError = e && e.message ? String(e.message) : 'unknown error';
        out.crudSyncHint =
          'Police session: POST /api/modify/sync-crud-mirror with JSON body { "caseId": "<caseId>" } ' +
          'to write CaseRegistry.getRecordHash into t_case_hash.';
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
 * POST /api/modify/sync-crud-mirror — police session; set t_case_hash.record_hash from
 * CaseRegistry.getRecordHash(indexHash) so CRUD mirror matches contract (S4.8).
 */
router.post('/api/modify/sync-crud-mirror', requirePoliceSession, async (req, res, next) => {
  const body = req.body || {};
  const caseId = normalizeCaseIdParam(body.caseId != null ? body.caseId : '');
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

  if (!chain.isChainConfigured()) {
    const detail = chain.getChainConfigGaps().join('\n');
    const err = new Error(`Chain not configured:\n${detail}`);
    err.status = 503;
    err.code = 'CHAIN_NOT_CONFIGURED';
    return next(err);
  }

  const indexHashRaw = hashOnly.computeIndexHash(caseId);

  try {
    const registryRh = await caseRegistryTx.getRecordHashOnRegistry(indexHashRaw);
    if (!registryRh) {
      const err = new Error(
        'CaseRegistry has no record hash for this case (createRecord / execute not done for this index)'
      );
      err.status = 400;
      err.code = 'REGISTRY_RECORD_HASH_EMPTY';
      return next(err);
    }

    const crud = await updateCrudMirrorWithRetries(indexHashRaw, registryRh);
    return res.status(200).json({
      caseId,
      recordHash: toHex0x(String(registryRh).replace(/^0x/i, '')),
      crudTxHash: crud.txHash,
      crudBlockNumber: crud.blockNumber
    });
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    } else if (e && e.code === 'CASE_REGISTRY_ADDR_MISSING') {
      e.status = 503;
    }
    return next(e);
  }
});

/**
 * GET /api/modify/pending-for-case/:caseId — judge session; scan local
 * `{caseId}::pending-0x…` keys and return those whose on-chain status is Pending.
 */
router.get('/api/modify/pending-for-case/:caseId', requireJudgeSession, async (req, res, next) => {
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

  const recordStore = getDefaultRecordStore();
  const prefix = `${caseId}::pending-`;
  const pendingOut = [];
  const localPendingSnapshotKeys = [];

  try {
    for (const k of recordStore.keys()) {
      if (!k.startsWith(prefix)) {
        continue;
      }
      localPendingSnapshotKeys.push(k);
      const rawPid = k.slice(prefix.length).trim();
      if (!rawPid) {
        continue;
      }
      const s = rawPid.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{64}$/.test(s)) {
        continue;
      }
      const pid = `0x${s.toLowerCase()}`;

      const p = await caseRegistryTx.getProposalFromRegistry(pid);
      if (p.status === 0 && /^0x0{64}$/i.test(String(p.indexHash || ''))) {
        continue;
      }
      if (p.statusName !== 'Pending') {
        continue;
      }

      pendingOut.push({
        ...proposalViewFromRegistry(p, pid),
        pendingKey: k
      });
    }
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    }
    return next(e);
  }

  let hint;
  if (pendingOut.length === 0 && localPendingSnapshotKeys.length > 0) {
    hint =
      'Local pending snapshots exist for this case, but none are Pending on-chain ' +
      '(the proposal may already be Approved, Rejected, or Executed). ' +
      'Use “Fetch by proposal ID” to view the current on-chain snapshot.';
  } else if (pendingOut.length === 0 && localPendingSnapshotKeys.length === 0) {
    hint =
      'No local caseId::pending-… entries. Police must POST /api/modify/propose for this case ' +
      '(gateway RECORD_STORE_PATH must match where the snapshot was written). ' +
      'Enter only the case ID (not “caseId=…”).';
  }

  return res.status(200).json({
    caseId,
    pending: pendingOut,
    localPendingSnapshotKeys,
    ...(hint ? { hint } : {})
  });
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
    return res.status(200).json(proposalViewFromRegistry(p, pid));
  } catch (e) {
    if (e && e.code === 'CHAIN_NOT_CONFIGURED') {
      e.status = 503;
    }
    return next(e);
  }
});

module.exports = router;
