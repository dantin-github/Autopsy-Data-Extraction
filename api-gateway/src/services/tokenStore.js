'use strict';

/** @type {Map<string, { userId: string, expiresAt: number }>} */
const store = new Map();

/**
 * Store a one-time token for a user. Same token string overwrites previous entry.
 * @param {string} userId
 * @param {string} token
 * @param {number} ttlMs time-to-live in milliseconds
 */
function issue(userId, token, ttlMs) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('ttlMs must be a positive number');
  }
  const key = String(token);
  store.set(key, {
    userId: String(userId),
    expiresAt: Date.now() + ttl
  });
}

/**
 * Validate token once: return { userId } and remove it, or null if missing/expired.
 * @param {string} token
 * @returns {{ userId: string } | null}
 */
function consume(token) {
  const key = String(token);
  const entry = store.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  return { userId: entry.userId };
}

/** Remove expired entries (optional housekeeping). */
function sweep() {
  const now = Date.now();
  for (const [tok, v] of store) {
    if (now > v.expiresAt) {
      store.delete(tok);
    }
  }
}

/** Test / dev: clear all tokens. */
function clear() {
  store.clear();
}

/** @returns {number} number of outstanding tokens */
function size() {
  return store.size;
}

module.exports = {
  issue,
  consume,
  sweep,
  clear,
  size
};
