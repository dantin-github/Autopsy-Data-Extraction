'use strict';

const chain = require('./chain');
const { logger } = require('../logger');

/** Delays before each CRUD update attempt (ms); first attempt is immediate. */
const CRUD_UPDATE_BACKOFF_MS = [0, 250, 750, 1500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort mirror of CaseRegistry into t_case_hash; transient RPC errors are retried (S4.8).
 * @param {string} indexHashRaw hex with or without 0x
 * @param {string} recordHashRaw 64 hex with or without 0x
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

module.exports = { updateCrudMirrorWithRetries, CRUD_UPDATE_BACKOFF_MS };
