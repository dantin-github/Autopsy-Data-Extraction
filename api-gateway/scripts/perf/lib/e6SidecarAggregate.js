'use strict';

/**
 * E6-sidecar: aggregates two JSONLs (crud vs registry arms) — N/A handling for CRUD caseRegistryMs, Δ totals.
 */

const fs = require('fs');
const path = require('path');
const stats = require('./stats');
const { residualUploadMs } = require('./e2Aggregate');

/**
 * @param {string} jsonlPath
 * @returns {object[]}
 */
function loadSidecarJsonl(jsonlPath) {
  const raw = require('fs').readFileSync(jsonlPath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') {
      continue;
    }
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      throw new Error(`E6 JSONL parse error in ${jsonlPath}: ${(e && e.message) || e}`);
    }
  }
  return out;
}

/** @param {{ ok?: boolean }[]} rows */
function pickOk(rows) {
  return rows.filter((x) => x.ok);
}

/**
 * @param {object[]} rows
 * @param {boolean} invokeRegistryReporting when false, omit caseRegistry quantiles entirely (display N/A)
 */
function summarizeArm(rows, invokeRegistryReporting) {
  const r = pickOk(rows);
  const quant = (fn) => {
    const vals = r.map(fn).filter(Number.isFinite);
    return vals.length ? stats.quantiles(vals) : { n: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  };
  const out = {
    n: r.length,
    integrity: quant((row) => row.integrityMs),
    localHash: quant((row) =>
      Number.isFinite(row.localHashMs) ? row.localHashMs : NaN
    ),
    recordStore: quant((row) =>
      Number.isFinite(row.recordStoreMs) ? row.recordStoreMs : NaN
    ),
    chain: quant((row) => row.chainMs),
    totalR: quant((row) => row.totalMs),
    client: quant((row) => row.clientRoundTripMs),
    residual: quant((row) => {
      const v = residualUploadMs({
        ok: row.ok,
        totalMs: row.totalMs,
        integrityMs: row.integrityMs,
        localHashMs: row.localHashMs,
        recordStoreMs: row.recordStoreMs,
        chainMs: row.chainMs,
        caseRegistryMs: Number.isFinite(row.caseRegistryMs) ? row.caseRegistryMs : 0
      });
      return Number.isFinite(v) ? v : NaN;
    })
  };

  let caseRegQuant = null;
  if (invokeRegistryReporting) {
    const vals = r.map((row) => row.caseRegistryMs).filter(Number.isFinite);
    caseRegQuant = vals.length ? stats.quantiles(vals) : { n: 0, min: NaN, max: NaN, mean: NaN, p50: NaN, p95: NaN, p99: NaN };
  }

  out.caseReg =
    invokeRegistryReporting && caseRegQuant && Number.isFinite(caseRegQuant.p50)
      ? caseRegQuant
      : null;

  return out;
}

/** @returns {number|NaN} */
function deltaOrNan(aB, aA) {
  if (!Number.isFinite(aB) || !Number.isFinite(aA)) {
    return NaN;
  }
  return aB - aA;
}

/**
 * Build CSV lines (with # summaries) plus markdown-ready tables.
 */
function buildE6CsvAndInsights(crudRows, registryRows, runIdMeta) {
  const crudOk = summarizeArm(crudRows, false);
  const regOk = summarizeArm(registryRows, true);

  const lines = [];
  lines.push(`# tag=e6_sidecar,runId=${runIdMeta}, armA_caseRegistry=not_invoked_NA`);
  lines.push(
    [
      `# crud_measure_n=${crudOk.n}`,
      `registry_measure_n=${regOk.n}`,
      `ΔtotalMs_p50=${deltaOrNan(regOk.totalR.p50, crudOk.totalR.p50)}`,
      `ΔclientRoundTripMs_p50=${deltaOrNan(regOk.client.p50, crudOk.client.p50)}`,
      `registry_caseRegistryMs_p50=${
        regOk.caseReg && Number.isFinite(regOk.caseReg.p50) ? regOk.caseReg.p50 : 'NA'
      }`
    ].join(',')
  );
  lines.push(
    '# crud_note: caseRegistryMs not applicable (CaseRegistry path not invoked); omit from stacking sums.'
  );

  lines.push(
    ['arm', 'measure_n', 'totalMs_p50', 'totalMs_p95', 'clientRoundTripMs_p50', 'clientRoundTripMs_p95', 'chainMs_p50', 'caseRegistryMs_p50'].join(
      ','
    )
  );
  lines.push(
    [
      'crud',
      crudOk.n,
      crudOk.totalR.p50,
      crudOk.totalR.p95,
      crudOk.client.p50,
      crudOk.client.p95,
      crudOk.chain.p50,
      'N/A'
    ].join(',')
  );
  lines.push(
    [
      'registry',
      regOk.n,
      regOk.totalR.p50,
      regOk.totalR.p95,
      regOk.client.p50,
      regOk.client.p95,
      regOk.chain.p50,
      regOk.caseReg && Number.isFinite(regOk.caseReg.p50) ? regOk.caseReg.p50 : 'NA'
    ].join(',')
  );
  lines.push('# delta rows (registry − crud), p50 unless noted');
  lines.push(
    [
      'ΔtotalMs_p50',
      deltaOrNan(regOk.totalR.p50, crudOk.totalR.p50),
      'ΔclientRoundTripMs_p50',
      deltaOrNan(regOk.client.p50, crudOk.client.p50),
      'ΔchainMs_p50',
      deltaOrNan(regOk.chain.p50, crudOk.chain.p50)
    ].join(',')
  );
  lines.push(
    '# ΔcaseRegistryMs: not defined versus crud arm — use registry arm caseRegistryMs_p50 only.'
  );

  return {
    lines,
    crudOk,
    regOk,
    deltaTotalP50: deltaOrNan(regOk.totalR.p50, crudOk.totalR.p50),
    deltaClientP50: deltaOrNan(regOk.client.p50, crudOk.client.p50)
  };
}

/**
 * @param {string} mdPath
 * @param {*} meta aggregated bundle from `writeReports` (`insights`, paths, optional PIDs).
 */
function writeE6SidecarMarkdown(mdPath, meta) {
  const fsW = require('fs');
  const now = new Date().toISOString();
  const body = `# E6-sidecar · CRUD mode vs CaseRegistry

## Purpose

Single-factor comparison of \`POST /api/upload\` under **\`CHAIN_MODE=crud\`** (CaseRegistry path not invoked) vs **\`CHAIN_MODE=contract\`** with CaseRegistry enabled. Supports RQ 2.2 / 2.3: **\`totalMs\`** (gateway), **\`clientRoundTripMs\`** (client-perceived), and **\`caseRegistryMs\`** on the registry arm only (contract security path proxy — not total security overhead).

See plan: \`docs/evidence/perf/crud-vs-case-registry-sidecar-plan.md\`.

## Isolation (run sheet)

| Item | Arm A (CRUD) | Arm B (registry) |
| :--- | :--- | :--- |
| Process | Separate Node invocation (gateway lifetime) | Separate Node invocation |
| \`RECORD_STORE_PATH\` | \`${meta.crudStore}\` | \`${meta.registryStore}\` |
| \`caseId\` prefix | \`perf-sidecar-crud-${meta.runId}-\` * | \`perf-sidecar-reg-${meta.runId}-\` * |
| Child PID (orchestrator) | ${meta.crudPid || '(see console)'} | ${meta.registryPid || '(see console)'} |

*Prefix includes \`runId=${meta.runId}\`.

## Method

- Two raw JSONL files (one per arm), sequential uploads, same payload size tier as chosen at run time.
- Warmup iterations are **not** written to JSONL (plan: discard warmups).
- Arm A raw rows **omit** \`caseRegistryMs\`; aggregate uses **N/A** — not treated as numeric zero in the summary table.

## Results

**Table E6.1: Arm summary (successful measured rows, milliseconds)**

| arm | n | totalMs p50 | totalMs p95 | clientRoundTripMs p50 | clientRoundTripMs p95 | chainMs p50 | caseRegistryMs p50 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| crud | ${meta.insights.crudOk.n} | ${meta.insights.crudOk.totalR.p50.toFixed(2)} | ${meta.insights.crudOk.totalR.p95.toFixed(2)} | ${meta.insights.crudOk.client.p50.toFixed(2)} | ${meta.insights.crudOk.client.p95.toFixed(2)} | ${meta.insights.crudOk.chain.p50.toFixed(2)} | **N/A** (path not invoked) |
| registry | ${meta.insights.regOk.n} | ${meta.insights.regOk.totalR.p50.toFixed(2)} | ${meta.insights.regOk.totalR.p95.toFixed(2)} | ${meta.insights.regOk.client.p50.toFixed(2)} | ${meta.insights.regOk.client.p95.toFixed(2)} | ${meta.insights.regOk.chain.p50.toFixed(2)} | ${
          meta.insights.regOk.caseReg && Number.isFinite(meta.insights.regOk.caseReg.p50)
            ? meta.insights.regOk.caseReg.p50.toFixed(2)
            : 'N/A'
        } |

**Δ (registry − crud), p50:** \`Δ totalMs = ${Number.isFinite(meta.insights.deltaTotalP50) ? meta.insights.deltaTotalP50.toFixed(2) : 'N/A'}\` ms · \`Δ clientRoundTripMs = ${Number.isFinite(meta.insights.deltaClientP50) ? meta.insights.deltaClientP50.toFixed(2) : 'N/A'}\` ms.

## Key observations

- Report **both** **Δ totalMs** and **Δ clientRoundTripMs** (e.g. at p50/p95) together with registry **caseRegistryMs** statistics; avoid presenting **caseRegistryMs** alone as the Autopsy-facing headline.
- Arm A **caseRegistryMs** is **not** observed — **N/A** in tables, **not** 0 ms of measured registry work.

## Artifacts & Repro

- [Raw arm A JSONL (${path.basename(meta.crudJsonl)})](./E6/${path.basename(meta.crudJsonl)})
- [Raw arm B JSONL (${path.basename(meta.registryJsonl)})](./E6/${path.basename(meta.registryJsonl)})
- [Derived CSV (${path.basename(meta.csvPath)})](./${path.basename(meta.csvPath)})
- Commands: \`npm run perf:e6:smoke\` / \`npm run perf:e6\`; offline: \`npm run perf:e6:aggregate-from-jsonl -- --crud <path> --registry <path>\`
- Markdown generated UTC: ${now}

`;

  fsW.mkdirSync(path.dirname(mdPath), { recursive: true });
  fsW.writeFileSync(mdPath, body, 'utf8');
}

module.exports = {
  loadSidecarJsonl,
  summarizeArm,
  buildE6CsvAndInsights,
  writeE6SidecarMarkdown
};
