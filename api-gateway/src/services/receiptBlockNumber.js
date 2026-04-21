'use strict';

/**
 * Normalize ledger block height from FISCO / Web3-style receipts.
 * The SDK may return `0x` hex, a decimal string, or a finite number; using
 * `parseInt(x, 16)` on a decimal value (e.g. 803 → "803") mis-decodes the height.
 *
 * @param {unknown} raw `receipt.blockNumber` or equivalent
 * @returns {number} non-negative integer block height
 */
function parseReceiptBlockNumber(raw) {
  if (raw === null || raw === undefined) {
    return 0;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  const s = String(raw).trim();
  if (s === '') {
    return 0;
  }
  if (/^0x[0-9a-fA-F]+$/i.test(s)) {
    return parseInt(s, 16);
  }
  if (/^[0-9]+$/.test(s)) {
    return parseInt(s, 10);
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

module.exports = { parseReceiptBlockNumber };
