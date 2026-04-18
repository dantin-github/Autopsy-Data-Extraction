'use strict';

const crypto = require('crypto');

/**
 * Case JSON aggregateHash verification (aligned with blockchain/.../IntegrityVerifier.java).
 * After parse, aggregateHash and aggregateHashNote are cleared, then the document is
 * serialized with lexicographically sorted object keys at every depth (Fastjson
 * SerializerFeature.MapSortField).
 */

function sortKeysDeep(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const sorted = {};
  for (const k of Object.keys(value).sort()) {
    sorted[k] = sortKeysDeep(value[k]);
  }
  return sorted;
}

function sha256HexUtf8(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * @param {string} caseDataJson Full case report JSON (UTF-8)
 * @returns {string} Lowercase hex SHA-256 of canonical body with hash fields cleared
 */
function computeHash(caseDataJson) {
  const json = JSON.parse(caseDataJson);
  json.aggregateHash = '';
  json.aggregateHashNote = '';
  const canonical = sortKeysDeep(json);
  return sha256HexUtf8(JSON.stringify(canonical));
}

/**
 * @param {string} caseDataJson Full case report JSON containing aggregateHash
 * @returns {boolean}
 */
function verify(caseDataJson) {
  const json = JSON.parse(caseDataJson);
  const storedHash = json.aggregateHash;
  if (storedHash == null || storedHash === '') {
    return false;
  }
  const computed = computeHash(caseDataJson);
  return computed.toLowerCase() === String(storedHash).toLowerCase();
}

module.exports = {
  computeHash,
  verify
};
