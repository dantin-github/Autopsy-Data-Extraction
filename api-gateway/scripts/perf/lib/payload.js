'use strict';

/**
 * Synthetic case JSON with valid aggregateHash, target UTF-8 size ~targetBytes.
 * E1 uses genAt (legacy: lower bound ~95% of target).
 * E2 uses genAtBand for strict ±tolerance bands around targetBytes.
 */

const integrity = require('../../../src/services/integrity');

/** E2 fixed size tiers (UTF-8 caseJson byte target). Keys match driver CLI. */
const E2_TIER_ORDER = ['10K', '100K', '1M', '5M', '10M'];
const E2_TIER_BYTES = {
  '10K': 10 * 1024,
  '100K': 100 * 1024,
  '1M': 1024 * 1024,
  '5M': 5 * 1024 * 1024,
  '10M': 10 * 1024 * 1024
};

function buildSkeleton(caseId, padText) {
  return {
    caseId,
    examiner: 'perf-examiner',
    aggregateHash: '',
    aggregateHashNote:
      'SHA-256 of JSON with aggregateHash+aggregateHashNote cleared, keys sorted lexicographically at every depth (UTF-8)',
    dataSources: [
      {
        id: 'perf-pad-source',
        name: 'performance-padding.bin',
        notes: padText
      }
    ]
  };
}

function finalizeCaseJson(skeletonObj) {
  const withoutAgg = JSON.stringify(skeletonObj);
  const agg = integrity.computeHash(withoutAgg);
  const out = { ...skeletonObj, aggregateHash: agg };
  const json = JSON.stringify(out);
  if (!integrity.verify(json)) {
    throw new Error('perf payload: aggregate verification failed');
  }
  return { caseJson: json, aggregateHash: agg };
}

function utf8LenForPad(caseId, plen) {
  const pad = 'P'.repeat(Math.max(0, plen | 0));
  const { caseJson } = finalizeCaseJson(buildSkeleton(caseId, pad));
  return { len: Buffer.byteLength(caseJson, 'utf8'), caseJson };
}

function genAt(targetBytes, caseId) {
  if (typeof targetBytes !== 'number' || targetBytes < 500) {
    throw new Error('genAt targetBytes must be number >= 500');
  }

  let hi = Math.max(Math.floor(targetBytes / 8), targetBytes >> 6);
  let last = utf8LenForPad(caseId, hi);
  const maxPad = Math.min(50 * 1024 * 1024, Math.floor(targetBytes * 32)); // caps memory
  while (last.len < targetBytes * 0.95 && hi <= maxPad) {
    hi = Math.ceil(hi * 1.5) + 1;
    last = utf8LenForPad(caseId, hi);
  }
  if (last.len < targetBytes * 0.95) {
    return { ...last, aggregateHash: JSON.parse(last.caseJson).aggregateHash, utf8Len: last.len };
  }

  let lo = 0;
  let bestHi = hi;
  while (lo <= hi && hi <= maxPad) {
    const mid = (lo + hi) >> 1;
    const { len } = utf8LenForPad(caseId, mid);
    if (len >= targetBytes * 0.95) {
      bestHi = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const { caseJson, len } = utf8LenForPad(caseId, bestHi);
  const agg = JSON.parse(caseJson).aggregateHash;
  return { caseJson, aggregateHash: agg, utf8Len: len };
}

/**
 * E2: UTF-8 length within [target*(1-tolerance), target*(1+tolerance)]; integrity.verify passes.
 * Finds the largest pad p with len(p) <= hiB; if the feasible band is non-empty, that p satisfies len >= loB.
 * @param {number} tolerance default 0.05 (±5%)
 */
function genAtBand(targetBytes, caseId, tolerance = 0.05) {
  if (typeof targetBytes !== 'number' || targetBytes < 500) {
    throw new Error('genAtBand targetBytes must be number >= 500');
  }
  if (typeof tolerance !== 'number' || tolerance <= 0 || tolerance >= 0.5) {
    throw new Error('genAtBand tolerance must be in (0, 0.5)');
  }

  const loB = targetBytes * (1 - tolerance);
  const hiB = targetBytes * (1 + tolerance);
  const maxPad = Math.min(
    55 * 1024 * 1024,
    Math.ceil(targetBytes * 1.2) + 65536
  );

  function lenAt(plen) {
    return utf8LenForPad(caseId, plen).len;
  }

  let lo = 0;
  let hi = maxPad;
  let largestLeHi = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lenAt(mid) <= hiB) {
      largestLeHi = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (largestLeHi < 0) {
    throw new Error(`genAtBand: len(0) > hiB (${hiB.toFixed(0)}) — increase maxPad or check caseId`);
  }

  const len = lenAt(largestLeHi);
  if (len < loB) {
    throw new Error(
      `genAtBand: no pad yields length in [${loB.toFixed(0)}, ${hiB.toFixed(
        0
      )}] (largest<=hiB at pad=${largestLeHi} has len=${len}; target=${targetBytes})`
    );
  }

  const { caseJson } = utf8LenForPad(caseId, largestLeHi);
  const agg = JSON.parse(caseJson).aggregateHash;
  return { caseJson, aggregateHash: agg, utf8Len: len };
}

module.exports = {
  genAt,
  genAtBand,
  E2_TIER_BYTES,
  E2_TIER_ORDER,
  finalizeCaseJson,
  buildSkeleton
};
