'use strict';

/**
 * Read append-only CaseRegistry audit lines (JSONL) for GET /api/audit (P8).
 */

const fs = require('fs');
const config = require('../config');

function parseSinceParam(sinceRaw) {
  if (sinceRaw == null || String(sinceRaw).trim() === '') {
    return null;
  }
  const t = String(sinceRaw).trim();
  if (/^\d+$/.test(t)) {
    const ms = parseInt(t, 10);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ limit?: number, since?: string|null, auditLogPath?: string }} opts
 * @returns {object[]}
 */
function readAuditLines(opts) {
  const limit = Math.min(Math.max(Number(opts && opts.limit) || 50, 1), 500);
  const since = parseSinceParam(opts && opts.since);
  const auditLogPath = (opts && opts.auditLogPath) || config.auditLogPath;

  let raw;
  try {
    raw = fs.readFileSync(auditLogPath, 'utf8');
  } catch {
    return [];
  }
  const lines = String(raw)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip corrupt line */
    }
  }

  let filtered = rows;
  if (since) {
    filtered = rows.filter((r) => {
      if (!r || r.ts == null) {
        return false;
      }
      const rowTime = new Date(String(r.ts));
      return !isNaN(rowTime.getTime()) && rowTime >= since;
    });
  }

  filtered.sort((a, b) => {
    const da = new Date(String(a.ts || ''));
    const db = new Date(String(b.ts || ''));
    const ma = da.getTime();
    const mb = db.getTime();
    if (!Number.isNaN(ma) && !Number.isNaN(mb) && ma !== mb) {
      return mb - ma;
    }
    const bn = (Number(b.blockNumber) || 0) - (Number(a.blockNumber) || 0);
    if (bn !== 0) {
      return bn;
    }
    const li = (Number(b.logIndex) || 0) - (Number(a.logIndex) || 0);
    if (li !== 0) {
      return li;
    }
    const ta = String(a.txHash || '');
    const tb = String(b.txHash || '');
    return tb.localeCompare(ta);
  });

  return filtered.slice(0, limit);
}

module.exports = { readAuditLines, parseSinceParam };
