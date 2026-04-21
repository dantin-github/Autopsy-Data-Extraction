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
 * Build a plain object for audit JSONL from `Interface.parseLog` output.
 *
 * **ethers v4 / legacy v5** (`node_modules/ethers` here): `LogDescription` uses
 * **`ev.values`** (not `ev.args`) and has **no `ev.fragment`**. Input names come from
 * **`iface.events[ev.signature].inputs`**.
 *
 * **Newer ethers v5/v6**: may expose `ev.args` + `ev.fragment.inputs`; we support both.
 *
 * @param {object} iface `ethers.utils.Interface` instance
 * @param {object | null | undefined} ev
 * @returns {Record<string, unknown>}
 */
function serializeEventArgs(iface, ev) {
  const values =
    ev && ev.values !== undefined && ev.values !== null ? ev.values : ev && ev.args;
  if (values == null) {
    return {};
  }

  let inputs = ev && ev.fragment && ev.fragment.inputs;
  if (!inputs || !Array.isArray(inputs)) {
    const sig = ev && ev.signature;
    const meta =
      sig && iface && iface.events && Object.prototype.hasOwnProperty.call(iface.events, sig)
        ? iface.events[sig]
        : null;
    inputs = meta && meta.inputs;
  }
  if (!inputs || !Array.isArray(inputs)) {
    return {};
  }

  const out = {};
  for (let i = 0; i < inputs.length; i++) {
    const name = inputs[i] && inputs[i].name ? String(inputs[i].name) : `_${i}`;
    let v;
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      v = values[name];
    } else {
      v = values[i];
    }
    const packed = serializeArgValue(v);
    if (packed !== undefined) {
      out[name] = packed;
    }
  }
  return out;
}

module.exports = { serializeArgValue, serializeEventArgs };
