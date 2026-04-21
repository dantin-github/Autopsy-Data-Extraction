'use strict';

const config = require('../config');
const chain = require('./chain');
const hashOnly = require('./hashOnly');
const { getDefaultRecordStore } = require('./recordStore');
const userStore = require('./userStore');
const caseRegistryTx = require('./caseRegistryTx');

/**
 * Normalize an EVM address from ABI/log decoding: 20-byte hex or 32-byte left-padded word.
 * @param {unknown} raw
 * @returns {string|null} `0x` + 40 lowercase hex, or null
 */
function coerceEvmAddress(raw) {
  if (raw == null) {
    return null;
  }
  let s = String(raw).trim().toLowerCase();
  if (!s.startsWith('0x')) {
    s = `0x${s}`;
  }
  const hex = s.slice(2);
  if (/^[0-9a-f]{40}$/.test(hex)) {
    return `0x${hex}`;
  }
  if (/^[0-9a-f]{64}$/.test(hex)) {
    return `0x${hex.slice(-40)}`;
  }
  return null;
}

/** @param {string} h */
function normalizeIndexHashKey(h) {
  if (h == null) {
    return null;
  }
  const s = String(h).trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) {
    return null;
  }
  return `0x${s}`;
}

/** @param {unknown} a */
function normalizeAddressKey(a) {
  return coerceEvmAddress(a);
}

function buildIndexHashToCaseIdMap() {
  const map = new Map();
  const store = getDefaultRecordStore();
  for (const key of store.keys()) {
    const caseId = key.includes('::') ? key.split('::')[0].trim() : String(key).trim();
    if (!caseId) {
      continue;
    }
    const raw = hashOnly.computeIndexHash(caseId);
    const k = normalizeIndexHashKey(raw);
    if (k) {
      map.set(k, caseId);
    }
  }
  return map;
}

function buildAddressToDisplayMap() {
  userStore.clearCache();
  const map = new Map();
  let users;
  try {
    users = userStore.getUsers();
  } catch {
    return map;
  }
  if (!Array.isArray(users)) {
    return map;
  }
  for (const u of users) {
    const addrRaw = u && u.onchainAddress != null ? String(u.onchainAddress).trim() : '';
    const ak = normalizeAddressKey(addrRaw);
    if (!ak) {
      continue;
    }
    const uname =
      u.username != null && String(u.username).trim() !== ''
        ? String(u.username).trim()
        : String(u.userId || '').trim() || ak;
    const role = u.role != null && String(u.role).trim() !== '' ? String(u.role).trim().toLowerCase() : '';
    const label = role ? `${uname} (${role})` : uname;
    map.set(ak, label);
  }
  return map;
}

function splitEventTs(tsRaw) {
  const s = String(tsRaw || '').trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return { eventDate: '—', eventTime: '—' };
  }
  const iso = d.toISOString();
  const [datePart, tPart] = iso.split('T');
  const timeNoMs = tPart ? tPart.replace(/\.\d{3}Z$/, '') : '—';
  return { eventDate: datePart || '—', eventTime: timeNoMs ? `${timeNoMs} Z` : '—' };
}

function pickCallerAddress(args) {
  if (!args || typeof args !== 'object') {
    return null;
  }
  if (args.creator != null && String(args.creator).trim() !== '') {
    return String(args.creator).trim();
  }
  if (args.proposer != null && String(args.proposer).trim() !== '') {
    return String(args.proposer).trim();
  }
  if (args.approver != null && String(args.approver).trim() !== '') {
    return String(args.approver).trim();
  }
  return null;
}

/**
 * Choose the most meaningful "who" address for this event type (proposer vs approver).
 * @param {string} event
 * @param {object} args
 */
function pickCallerAddressForEvent(event, args) {
  if (!args || typeof args !== 'object') {
    return null;
  }
  const ev = String(event || '').trim();
  const pick = (keys) => {
    for (const k of keys) {
      if (args[k] != null && String(args[k]).trim() !== '') {
        return String(args[k]).trim();
      }
    }
    return null;
  };
  if (ev === 'ProposalApproved' || ev === 'ProposalRejected') {
    return pick(['approver', 'proposer', 'creator']) || pickCallerAddress(args);
  }
  if (ev === 'ProposalCreated') {
    return pick(['proposer', 'creator']) || pickCallerAddress(args);
  }
  if (ev === 'RecordCreated') {
    return pick(['creator', 'proposer']) || pickCallerAddress(args);
  }
  return pickCallerAddress(args);
}

/** @param {string} addr */
function shortAddress(addr) {
  const coerced = coerceEvmAddress(addr);
  if (!coerced) {
    const s = String(addr || '').trim();
    return s || '—';
  }
  return `${coerced.slice(0, 6)}…${coerced.slice(-4)}`;
}

/** @param {string} pid */
function proposalCacheKey(pid) {
  return String(pid || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {object[]} items from readAuditLines
 * @returns {Promise<object[]>}
 */
async function enrichAuditItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const regAddr = String(config.caseRegistryAddr || '').trim();
  const canQueryRegistry =
    regAddr && /^0x[0-9a-fA-F]{40}$/i.test(regAddr) && chain.isChainConfigured();

  const indexToCase = buildIndexHashToCaseIdMap();
  const addrToDisplay = buildAddressToDisplayMap();

  const proposalIndexCache = new Map();
  const proposalReasonCache = new Map();
  const proposalProposerCache = new Map();

  const needsLookup = new Set();
  for (const item of items) {
    const args = item && item.args;
    if (!args || typeof args !== 'object') {
      continue;
    }
    if (args.indexHash) {
      if (args.proposalId != null && String(args.proposalId).trim() !== '') {
        needsLookup.add(String(args.proposalId).trim());
      }
      continue;
    }
    if (args.proposalId != null && String(args.proposalId).trim() !== '') {
      needsLookup.add(String(args.proposalId).trim());
    }
  }

  if (canQueryRegistry && needsLookup.size > 0) {
    await Promise.all(
      [...needsLookup].map(async (pid) => {
        const ck = proposalCacheKey(pid);
        try {
          const p = await caseRegistryTx.getProposalFromRegistry(pid);
          if (p && p.indexHash) {
            proposalIndexCache.set(ck, normalizeIndexHashKey(p.indexHash));
          } else {
            proposalIndexCache.set(ck, null);
          }
          if (p && p.reason != null && String(p.reason).trim() !== '') {
            proposalReasonCache.set(ck, String(p.reason));
          }
          if (p && p.proposer) {
            const pk = coerceEvmAddress(p.proposer);
            if (pk) {
              proposalProposerCache.set(ck, pk);
            }
          }
        } catch {
          proposalIndexCache.set(ck, null);
        }
      })
    );
  }

  function resolveIndexHashForItem(args) {
    if (!args || typeof args !== 'object') {
      return null;
    }
    const direct = normalizeIndexHashKey(args.indexHash);
    if (direct) {
      return direct;
    }
    const pid = args.proposalId != null ? String(args.proposalId).trim() : '';
    if (!pid) {
      return null;
    }
    return proposalIndexCache.get(proposalCacheKey(pid)) || null;
  }

  return items.map((item) => {
    const args = item && item.args && typeof item.args === 'object' ? item.args : {};
    const event = String(item.event || '').trim();
    const ih = resolveIndexHashForItem(args);
    const caseId = ih ? indexToCase.get(ih) || null : null;

    let callerAddrRaw = pickCallerAddressForEvent(event, args);
    if (
      !callerAddrRaw &&
      event === 'ProposalExecuted' &&
      args.proposalId != null &&
      String(args.proposalId).trim() !== ''
    ) {
      const ck = proposalCacheKey(args.proposalId);
      const fromReg = proposalProposerCache.get(ck);
      callerAddrRaw = fromReg || null;
    }

    const ak = callerAddrRaw ? normalizeAddressKey(callerAddrRaw) : null;
    const callerName = ak && addrToDisplay.has(ak)
      ? addrToDisplay.get(ak)
      : callerAddrRaw
        ? shortAddress(callerAddrRaw)
        : '—';

    let rejectReason = '';
    if (event === 'ProposalRejected') {
      rejectReason =
        args.reason != null && String(args.reason).trim() !== ''
          ? String(args.reason).trim()
          : '';
      if (!rejectReason && args.proposalId) {
        rejectReason = proposalReasonCache.get(proposalCacheKey(args.proposalId)) || '';
      }
    }

    const { eventDate, eventTime } = splitEventTs(item.ts);

    return {
      ...item,
      caseId: caseId || null,
      callerName,
      rejectReason: rejectReason || null,
      eventDate,
      eventTime
    };
  });
}

module.exports = { enrichAuditItems, splitEventTs, coerceEvmAddress };
