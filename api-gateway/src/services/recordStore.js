'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Private off-chain JSON map: { [caseId]: fullRecordJsonString } — same file shape as
 * {@code CaseRecordStore} in blockchain (user-home {@code .case_record_store.json} by default).
 */

function nz(v) {
  if (v == null) {
    return '';
  }
  return String(v);
}

function createRecordStore(options = {}) {
  const storePath = options.storePath;
  if (!storePath || typeof storePath !== 'string') {
    throw new TypeError('createRecordStore({ storePath }) requires storePath');
  }

  function loadStore() {
    if (!fs.existsSync(storePath)) {
      return {};
    }
    const raw = fs.readFileSync(storePath, 'utf8').trim();
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  }

  function writeStore(store) {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store), 'utf8');
  }

  return {
    storePath,

    get(caseId) {
      const store = loadStore();
      const v = store[nz(caseId)];
      if (v === undefined || v === null) {
        return null;
      }
      return String(v);
    },

    exists(caseId) {
      return this.get(caseId) != null;
    },

    /**
     * Two overloads (same as Java CaseRecordStore):
     * - save(caseId, fullRecordJson)
     * - save(caseId, caseJson, aggregateHash, examiner, createdAt)
     */
    save(caseId, a, b, c, d) {
      const id = nz(caseId);
      const n = arguments.length;
      if (n === 2) {
        const store = loadStore();
        store[id] = nz(a);
        writeStore(store);
        return;
      }
      if (n === 5) {
        const o = {
          case_id: id,
          case_json: nz(a),
          aggregate_hash: nz(b),
          examiner: nz(c),
          created_at: nz(d)
        };
        return this.save(id, JSON.stringify(o));
      }
      throw new TypeError(
        'save(caseId, fullRecordJson) or save(caseId, caseJson, aggregateHash, examiner, createdAt)'
      );
    }
  };
}

let defaultInstance;
function getDefaultRecordStore() {
  if (!defaultInstance) {
    const config = require('../config');
    defaultInstance = createRecordStore({ storePath: config.recordStorePath });
  }
  return defaultInstance;
}

module.exports = {
  createRecordStore,
  getDefaultRecordStore
};
