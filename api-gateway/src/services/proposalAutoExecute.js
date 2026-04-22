'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logger } = require('../logger');
const caseRegistryTx = require('./caseRegistryTx');
const chain = require('./chain');
const { getDefaultRecordStore } = require('./recordStore');
const { updateCrudMirrorWithRetries } = require('./crudMirror');

const BACKLOG_DRAIN_PER_TICK = 5;
const EXECUTED_POLL_MS = 250;
const EXECUTED_POLL_ATTEMPTS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @returns {Promise<object|null>} proposal view when status Executed, else null */
async function waitUntilProposalExecuted(pid) {
  for (let i = 0; i < EXECUTED_POLL_ATTEMPTS; i += 1) {
    if (i > 0) {
      await sleep(EXECUTED_POLL_MS);
    }
    try {
      const pr = await caseRegistryTx.getProposalFromRegistry(pid);
      if (pr.statusName === 'Executed') {
        return pr;
      }
    } catch (_) {
      /* RPC lag — retry */
    }
  }
  return null;
}

function cursorPath() {
  return config.executorCursorPath;
}

function loadCursor() {
  try {
    const raw = fs.readFileSync(cursorPath(), 'utf8');
    const j = JSON.parse(raw);
    return {
      autoExecuteDone:
        j.autoExecuteDone && typeof j.autoExecuteDone === 'object' ? j.autoExecuteDone : {},
      crudBacklog: Array.isArray(j.crudBacklog) ? j.crudBacklog : []
    };
  } catch {
    return { autoExecuteDone: {}, crudBacklog: [] };
  }
}

function saveCursor(state) {
  fs.mkdirSync(path.dirname(cursorPath()), { recursive: true });
  fs.writeFileSync(cursorPath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizeProposalId(hex) {
  const s = String(hex || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    return null;
  }
  return `0x${s.toLowerCase()}`;
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

async function tryMergeRecordStore(proposalId) {
  const recordStore = getDefaultRecordStore();
  const pendingLoc = findPendingEntryForProposal(recordStore, proposalId);
  if (!pendingLoc) {
    return;
  }
  const pendingFull = recordStore.get(pendingLoc.pendingKey);
  if (pendingFull == null) {
    return;
  }
  recordStore.save(pendingLoc.caseId, pendingFull);
  recordStore.remove(pendingLoc.pendingKey);
  logger.info(
    { caseId: pendingLoc.caseId, proposalId, evt: 'auto_execute_record_store_merged' },
    'Merged pending snapshot after auto-execute'
  );
}

async function tryCrudSync(proposalId, proposal) {
  const indexHash = proposal && proposal.indexHash != null ? String(proposal.indexHash) : '';
  const newRh = proposal && proposal.newRecordHash != null ? String(proposal.newRecordHash) : '';
  if (!indexHash || !newRh) {
    return;
  }
  const recordHex = newRh.replace(/^0x/i, '');
  try {
    await updateCrudMirrorWithRetries(indexHash, recordHex);
    logger.info({ proposalId, evt: 'auto_execute_crud_ok' }, 'CRUD mirror updated after auto-execute');
  } catch (e) {
    logger.warn(
      { proposalId, err: e && e.message ? String(e.message) : String(e) },
      'autoExecute: CRUD update failed; queued for backlog'
    );
    const state = loadCursor();
    const b = state.crudBacklog || [];
    const pidLo = String(proposalId).toLowerCase();
    const merged = b.filter((x) => String(x.proposalId || '').toLowerCase() !== pidLo);
    merged.push({
      proposalId,
      indexHash,
      newRecordHash: recordHex,
      addedAt: new Date().toISOString(),
      attempts: 0
    });
    state.crudBacklog = merged;
    saveCursor(state);
  }
}

/**
 * Retry CRUD mirror writes that failed after a successful on-chain execute.
 */
async function drainCrudBacklogTick() {
  if (!config.autoExecuteAfterApprove) {
    return;
  }
  if (!chain.isChainConfigured()) {
    return;
  }
  const state = loadCursor();
  const backlog = state.crudBacklog || [];
  if (backlog.length === 0) {
    return;
  }
  const keep = [];
  let drained = 0;
  for (const item of backlog) {
    if (drained >= BACKLOG_DRAIN_PER_TICK) {
      keep.push(item);
      continue;
    }
    drained += 1;
    try {
      await updateCrudMirrorWithRetries(item.indexHash, item.newRecordHash);
      logger.info(
        { proposalId: item.proposalId, evt: 'auto_execute_crud_backlog_ok' },
        'CRUD mirror recovered from backlog'
      );
    } catch (e) {
      item.lastErr = e && e.message ? String(e.message) : String(e);
      item.attempts = (item.attempts || 0) + 1;
      keep.push(item);
      logger.warn(
        { proposalId: item.proposalId, attempts: item.attempts, err: item.lastErr },
        'CRUD backlog retry failed'
      );
    }
  }
  state.crudBacklog = keep;
  saveCursor(state);
}

/**
 * After judge approve: system-executor signs execute, merge local pending store, sync CRUD.
 * @param {{ proposalIdHex: string, txHash: string, blockNumber: number }} meta
 */
async function onProposalApprovedFromAudit(meta) {
  if (!config.autoExecuteAfterApprove) {
    return;
  }
  const pwd = String(config.executorKeystorePassword || '').trim();
  if (!pwd) {
    return;
  }
  const pid = normalizeProposalId(meta.proposalIdHex);
  if (!pid) {
    return;
  }

  let state = loadCursor();
  if (state.autoExecuteDone[pid]) {
    return;
  }

  let p;
  try {
    p = await caseRegistryTx.getProposalFromRegistry(pid);
  } catch (e) {
    logger.warn(
      { pid, err: e && e.message ? String(e.message) : String(e) },
      'autoExecute: getProposal failed'
    );
    return;
  }

  if (p.statusName === 'Executed') {
    state.autoExecuteDone[pid] = {
      at: new Date().toISOString(),
      via: 'already_executed',
      approveAuditTxHash: meta.txHash
    };
    saveCursor(state);
    await tryMergeRecordStore(pid);
    await tryCrudSync(pid, p);
    return;
  }

  if (p.statusName !== 'Approved') {
    logger.warn(
      { pid, status: p.statusName },
      'autoExecute: unexpected proposal status when processing ProposalApproved'
    );
    return;
  }

  let execResult;
  try {
    execResult = await caseRegistryTx.executeAsExecutor({ proposalIdHex: pid });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    try {
      const p2 = await waitUntilProposalExecuted(pid);
      if (p2) {
        state = loadCursor();
        state.autoExecuteDone[pid] = {
          at: new Date().toISOString(),
          via: 'execute_race',
          approveAuditTxHash: meta.txHash
        };
        saveCursor(state);
        await tryMergeRecordStore(pid);
        await tryCrudSync(pid, p2);
        return;
      }
    } catch (_) {
      /* ignore */
    }
    logger.warn(
      { pid, err: msg, code: e && e.code ? e.code : undefined },
      'autoExecute: executeAsExecutor failed'
    );
    return;
  }

  const pAfter = await waitUntilProposalExecuted(pid);
  if (!pAfter) {
    logger.warn(
      { pid, executeTxHash: execResult && execResult.txHash ? execResult.txHash : null },
      'autoExecute: execute tx submitted but proposal not Executed after polls (RPC lag or revert)'
    );
    return;
  }

  state = loadCursor();
  state.autoExecuteDone[pid] = {
    at: new Date().toISOString(),
    executeTxHash: execResult.txHash,
    approveAuditTxHash: meta.txHash,
    blockNumber: meta.blockNumber
  };
  saveCursor(state);

  await tryMergeRecordStore(pid);
  await tryCrudSync(pid, pAfter);
}

module.exports = {
  onProposalApprovedFromAudit,
  drainCrudBacklogTick
};
