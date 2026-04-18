'use strict';

const crypto = require('crypto');

/**
 * Hash-only chain storage (aligned with blockchain/.../HashOnlyRecord.java).
 * index_hash = SHA256(case_id UTF-8); record_hash = SHA256(canonical JSON UTF-8).
 */

function sha256HexUtf8(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function nz(v) {
  if (v == null) {
    return '';
  }
  return String(v);
}

function computeIndexHash(caseId) {
  return sha256HexUtf8(nz(caseId));
}

/**
 * Canonical record: keys case_id, case_json, aggregate_hash, examiner, created_at (insertion order).
 */
function computeRecordHash(caseId, caseJson, aggregateHash, examiner, createdAt) {
  const o = {
    case_id: nz(caseId),
    case_json: nz(caseJson),
    aggregate_hash: nz(aggregateHash),
    examiner: nz(examiner),
    created_at: nz(createdAt)
  };
  return sha256HexUtf8(JSON.stringify(o));
}

function computeRecordHashFromJson(fullRecordJson) {
  const o = JSON.parse(fullRecordJson);
  return computeRecordHash(o.case_id, o.case_json, o.aggregate_hash, o.examiner, o.created_at);
}

function verifyRecordHash(fullRecordJson, chainRecordHash) {
  const computed = computeRecordHashFromJson(fullRecordJson);
  if (!computed || chainRecordHash == null) {
    return false;
  }
  return computed.toLowerCase() === String(chainRecordHash).toLowerCase();
}

module.exports = {
  computeIndexHash,
  computeRecordHash,
  computeRecordHashFromJson,
  verifyRecordHash
};
