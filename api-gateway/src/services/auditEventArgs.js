'use strict';

const ethers = require('ethers');

function serializeArgValue(v) {
  if (v == null) {
    return undefined;
  }
  if (ethers.utils.BigNumber.isBigNumber(v)) {
    return v.toString();
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'object' && typeof v.toHexString === 'function') {
    return v.toHexString().toLowerCase();
  }
  return String(v);
}

/**
 * Build a plain object for audit JSONL from `Interface.parseLog` output (`ev`).
 * ethers v5 `ev.args` is a `Result`: numeric indices hold values; `Object.keys(args)`
 * is often only ["0","1",…], so iterating ABI input names is required.
 *
 * @param {{ args?: unknown, fragment?: { inputs?: { name?: string }[] } }} | null | undefined} ev
 * @returns {Record<string, unknown>}
 */
function serializeEventArgs(ev) {
  const args = ev && ev.args;
  const inputs = ev && ev.fragment && ev.fragment.inputs;
  if (!args || !inputs || !Array.isArray(inputs)) {
    return {};
  }
  const out = {};
  for (let i = 0; i < inputs.length; i++) {
    const name = inputs[i] && inputs[i].name ? String(inputs[i].name) : `_${i}`;
    const packed = serializeArgValue(args[i]);
    if (packed !== undefined) {
      out[name] = packed;
    }
  }
  return out;
}

module.exports = { serializeArgValue, serializeEventArgs };
