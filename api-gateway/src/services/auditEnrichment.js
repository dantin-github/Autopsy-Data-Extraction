'use strict';

const config = require('../config');
const chain = require('./chain');
const hashOnly = require('./hashOnly');
const { getDefaultRecordStore } = require('./recordStore');
const userStore = require('./userStore');
const caseRegistryTx = require('./caseRegistryTx');

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

/** @param {string} a */
function normalizeAddressKey(a) {
  if (a == null || String(a).trim() === '') {
    return null;
  }
  const s = String(a).trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) {
    return null;
  }
  return s;
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

function buildAddressToUsernameMap() {
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
    const addr = u && u.onchainAddress != null ? String(u.onchainAddress).trim() : '';
    const ak = normalizeAddressKey(addr);
    if (!ak) {
      continue;
    }
    const label =
      u.username != null && String(u.username).trim() !== ''
        ? String(u.username).trim()
        : String(u.userId || '').trim() || ak;
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

/** @param {string} addr */
function shortAddress(addr) {
  const s = String(addr || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) {
    return s || '—';
  }
  const lower = s.toLowerCase();
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`;
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
  const addrToUser = buildAddressToUsernameMap();

  const proposalIndexCache = new Map();
  const proposalReasonCache = new Map();

  const needsLookup = new Set();
  for (const item of items) {
    const args = item && item.args;
    if (!args || typeof args !== 'object') {
      continue;
    }
    if (args.indexHash) {
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

    const callerAddr = pickCallerAddress(args);
    const ak = normalizeAddressKey(callerAddr);
    const callerName = ak && addrToUser.has(ak)
      ? addrToUser.get(ak)
      : callerAddr
        ? shortAddress(callerAddr)
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

module.exports = { enrichAuditItems, splitEventTs };
