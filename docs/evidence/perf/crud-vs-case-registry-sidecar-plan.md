# Sidecar plan: CRUD mode vs CaseRegistry (upload path)

Standalone add-on methodology. **Does not supersede or edit** the main Autopsy/blockchain performance test plan or the E1–E5 milestone table — use this only when you need a **single-factor** comparison between `**CHAIN_MODE=crud`** (no CaseRegistry) and `**CHAIN_MODE=contract**` (CaseRegistry enabled).

---

## Goal

Same chain instance and environment; measure **observable latency** differences for `POST /api/upload` between:


| Arm                         | `CHAIN_MODE` | `CASE_REGISTRY_ADDR`                                    | `UPLOAD_USE_CASE_REGISTRY`                | Behaviour                                                                               |
| --------------------------- | ------------ | ------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| **A — CRUD-only**           | `crud`       | May be deployed; **omit or set false** registry trigger | `**0`/unset** (default with `crud`)       | **CaseRegistry path not invoked** — see **CRUD arm: `caseRegistryMs` reporting** below. |
| **B — Contract + Registry** | `contract`   | **Set (valid)**                                         | Default when `CASE_REGISTRY_ADDR` present | Matches existing E1-style breakdown: `**chainMs` + `caseRegistryMs`**                   |


Keep parity everywhere else (gateway build, payload bytes and structure, concurrency — recommend **serial** first), same as E1 for comparability.

---

## Isolation controls (required for a clean contrast)

Use these so the comparison is not diluted by **shared in-process state**, **case-level idempotency/dedup**, or **local persistence bleed**. Together they better support the claim that **contract-side security mechanisms (extra transaction path, on-chain checks, role gates bundled in registry work) carry observable performance cost** above a CRUD-only upload leg.


| Control                          | Requirement                                                                                                                                                                                                                                   | Rationale                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Independent process**      | Run **arm A and arm B in separate OS-level gateway lifetimes** (e.g. two distinct `node` invocations, or stop/restart the gateway between arms). **Do not** flip `CHAIN_MODE` inside one long-lived supertest process without a full restart. | Avoids stale singletons (config cache, in-memory token stores, module-level caches) and gives each arm a clean **Node process** boundary aligned with flipping deployment mode in practice. |
| **2 — Distinct `caseId` space**  | **No reuse of the same `caseId` string** across arms for measured rows. Use disjoint prefixes (e.g. `perf-sidecar-crud-<runId>-<i>` vs `perf-sidecar-reg-<runId>-<i>`) for every upload in the sample.                                        | Prevents cross-arm interference from deduplication, executor/cursor backlogs, or “already known case” short-circuits that would confound timing.                                            |
| **3 — Independent record store** | **Separate `RECORD_STORE_PATH` per arm** (two temp files or directories, documented in the run log). Do not point both arms at the same on-disk store without clearing between modes.                                                         | Keeps local CRUD/proposal state, cursors, and audit side files from one arm affecting the other.                                                                                            |


**What stays shared (on purpose):** the **same blockchain network and contract deployment** for both arms, so chain latency and block conditions are as comparable as a single-run study allows. State **on-chain** still diverges (arm B creates registry records); that difference is part of the effect you are measuring.

---

## Load & scale

- **Primary:** same bulk as E1 (e.g. current ~48 KB tier), **N ≥ 30** sequential uploads, **5** warmup iterations discarded (tune if needed).
- **Optional tier:** duplicate one E2 size bucket only after the primary completes.

---

## Instrumentation & fields

- Send `**X-Debug-Timing: 1`** (or enable `UPLOAD_TIMING_IN_RESPONSE`) and record the existing JSONL fields: `integrityMs`, `recordStoreMs`, `chainMs`, `totalMs`, `clientRoundTripMs`, residuals, and for arm B `caseRegistryMs` plus on-chain identifiers if present.

### CRUD arm: `caseRegistryMs` reporting

- Arm A may yield `**caseRegistryMs` missing from the JSON object** or `**0`** depending on gateway serialization; **either is acceptable in raw JSONL**.
- In the **aggregate / summary table**, for arm A do **not** treat a missing field as numeric zero for sums or stage stacks. Use `**N/A`** (or an explicit label such as **“not applicable”**) and state in prose that the **CaseRegistry path was not invoked** — so readers are not led to believe you **measured “0 ms contract-side registry work”** on that arm. Only arm B carries a measured `caseRegistryMs` attributable to the registry transaction path.

**Attribution in prose:** treat Solidity role checks, state `require`s, and `emit` as **bundled inside** arm B’s `caseRegistryMs` / the registry transaction — not broken out unless you add separate tracing (state in **limitations**).

### Cross-arm deltas and RQ 2.3

Report **both** of the following when contrasting arm B to arm A (e.g. median or p95 per arm):


| Metric                            | Role in the thesis                                                                                                                                                   | Suggested Δ                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `**clientRoundTripMs`**           | Closer to **end-user / client-perceived** cost (RQ 2.3: impact on operators and integrated clients such as Autopsy along the upload path).                           | **Δ `clientRoundTripMs`**                                                                                                                    |
| `**totalMs**`                     | Closer to **gateway-side processing** cost (excluding early middleware if timing starts post-auth, per existing instrumentation).                                    | **Δ `totalMs`**                                                                                                                              |
| `**caseRegistryMs` (arm B only)** | A **proxy** for work on the **contract security / registry leg**, not synonymous with total “security overhead” — auth and other legs may live outside these fields. | Report arm B statistics; optionally **Δ versus N/A** only in prose, not as a numeric sum that implies arm A had a timed zero registry stage. |


Do **not** present `**caseRegistryMs` alone** as the sole headline for Autopsy-facing performance; pair it with `**Δ totalMs`** and `**Δ clientRoundTripMs**` so the narrative matches RQ 2.3.

---

## Deliverables (minimal)

1. One JSONL (or pair of files) per arm; small aggregate (p50/p95) — reuse E1-style scripts or a short copy; **do not merge** into the main `summary.md` unless you choose to add a link later. Aggregation code must implement `**caseRegistryMs` = `N/A` for arm A** when the field is absent (no silent coercion to `0` for totals).
2. One **comparison table** with per-arm medians (or p50/p95 as you standardise) for at least `totalMs`, `clientRoundTripMs`, `chainMs`, and arm B `caseRegistryMs`; plus explicit rows or columns for **Δ `totalMs`** and **Δ `clientRoundTripMs`** (B − A or relative %, per your chapter convention). Arm A row: `**caseRegistryMs` → `N/A**` with footnote “CaseRegistry path not invoked.”
3. Short **run sheet** per arm documenting the isolation controls: gateway **process** boundary (e.g. start time + PID or “fresh invocation”), `**RECORD_STORE_PATH`**, and `**caseId` prefix** pattern.
4. **Limitations:** shared chain/deployment by design; serial runs; follow the existing perf harness prerequisites for police `X-Auth-Token` (see `api-gateway/scripts/perf/README.md` and `npm run perf:precheck`).

---

## Implementation (this repository)

Orchestrator and arms live under `**api-gateway/scripts/perf/`**:

- `e6-crud-vs-registry.js` — runs `precheck`, then `**node e6-sidecar-arm.js` twice** (CRUD → registry child processes).
- `e6-sidecar-arm.js` — one arm per OS process; configures `CHAIN_MODE`, `RECORD_STORE_PATH`, emits JSONL rows (CRUD omits `**caseRegistryMs`** in raw output).
- `lib/e6SidecarAggregate.js` — CSV + Markdown with **N/A** for arm A `caseRegistryMs` and Δ `totalMs` / Δ `clientRoundTripMs`.
- `e6-aggregate-from-jsonl.js` — offline regeneration from existing JSONLs.

Canonical artefact paths (same tree as **E1–E5**, under `**docs/evidence/perf/results/`**):


| Kind                                                                    | Path                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| Narrative MD                                                            | `**results/e6-crud-vs-registry.md**`              |
| Derived CSV                                                             | `**results/e6-crud-vs-registry.csv**`             |
| Raw arm A JSONL                                                         | `**results/E6/e6-sidecar.arm-crud.jsonl**`        |
| Raw arm B JSONL                                                         | `**results/E6/e6-sidecar.arm-registry.jsonl**`    |
| Run sheet (JSON, includes `recordStorePath` + child PIDs after success) | `**results/E6/e6-sidecar-runsheet-<runId>.json**` |


npm (from `**api-gateway/**`): `**npm run perf:e6**` (full defaults), `**npm run perf:e6:smoke**`, `**npm run perf:e6:aggregate-from-jsonl**`.

---

## Effort (rough)

With existing perf harness and timing: **~0.5–1.5 person-days** for two env presets, **two process lifetimes**, distinct stores and `caseId` namespaces, runs, and a one-page table — no contract changes. Optional driver/wrapper that runs arm A then arm B with scripted env + paths is convenience only.

---

## Risks

- Mis-set env: arm B needs `signingPassword`; arm A must not set `UPLOAD_USE_CASE_REGISTRY=1` unless you intend registry on `crud`.
- Do not mix arms across chain resets or different contract deployments without documenting it.
- If isolation is skipped (same process, same store, overlapping `caseId`), treat results as **exploratory only** — not sufficient for the “security mechanism ⇒ extra cost” claim.

