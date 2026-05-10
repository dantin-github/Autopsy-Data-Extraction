# Performance evidence

English-only operator notes for `docs/evidence/perf/`.

## Directory layout

- **`results/eX-<name>.md`** — Per-experiment markdown report (shared seven-section skeleton).
- **`results/eX-<name>.csv`** — Aggregated CSV derived from the run (same basename as the report).
- **`results/EX/`** — Raw output for experiment **X**. Put the **canonical JSONL** here, and any similar raw artifacts (extra `.jsonl`, `.ndjson`, trace fragments) for that experiment. **Do not** place these under `data/` (see below).
- **E2** — Tier keys and `genAtBand` in `api-gateway/scripts/perf/lib/payload.js`. Payload preflight: `npm run perf:e2:payload-sanity` (optional `--upload`). Driver: `npm run perf:e2` (default `results/E2/e2-sizes.jsonl`). E2.3 smoke: `npm run perf:e2:smoke`. E2.4 full run: `npm run perf:e2:full`. Regenerate aggregates: `npm run perf:e2:csv-from-jsonl`, `npm run perf:e2:md-from-jsonl`.
- **E3** — Concurrency throughput: `npm run perf:e3` (`results/E3/e3-concurrency.jsonl`, 60 s × levels 1,2,4,8,16, 100 KB payload). Smoke: `npm run perf:e3:smoke`. Full gates (E3.3): `npm run perf:e3:full`. Offline `npm run perf:e3:csv-from-jsonl` / `perf:e3:md-from-jsonl`. Dry skeleton (no uploads): `node scripts/perf/e3-concurrency.js --dry --levels 2 --duration 5s --size 100KB`.
- **E4** — Blockchain impact (real vs mocked chain): `npm run perf:e4:chain-mock-sanity`, `npm run perf:e4:mock-sanity`; main driver `npm run perf:e4` → `results/E4/e4-impact.jsonl` + `e4-impact.csv`/`.md`. Reuse E1 real rows: `npm run perf:e4:reuse`. Canonical live gate: `npm run perf:e4:full`. Offline: `perf:e4:aggregate-from-jsonl`, `perf:e4:md-from-jsonl`.
- **E5** — Read-path latency (`/api/query` vs `/api/case-exists`): `npm run perf:e5` (seeds corpus, defaults to 200×2 JSONL rows + CSV/Markdown). Smoke: `npm run perf:e5:smoke`. Canonical gate: `npm run perf:e5:full` (`results/E5/e5-reads.jsonl`; wall budget tunable via `PERF_E5_WALL_MS`). Offline CSV/Markdown: `npm run perf:e5:aggregate-from-jsonl`, `npm run perf:e5:md-from-jsonl`. Requires existing `results/E1/e1-breakdown.jsonl` for upload baseline ratios.
- **E6 (sidecar)** — CRUD vs CaseRegistry uploads in **two separate child processes**: `npm run perf:e6` (default warmup=5 measure=30, 50KB); smoke: `perf:e6:smoke`; raw `results/E6/e6-sidecar.arm-{crud,registry}.jsonl`, narrative `results/e6-crud-vs-registry.md`, derived `results/e6-crud-vs-registry.csv`, run sheet JSON under `results/E6/`. Offline: `perf:e6:aggregate-from-jsonl`. Plan: [`crud-vs-case-registry-sidecar-plan.md`](./crud-vs-case-registry-sidecar-plan.md).

| Stage | Folder | Canonical JSONL (default `--out`) |
| :--- | :--- | :--- |
| E1 | `results/E1/` | `e1-breakdown.jsonl` |
| E2 | `results/E2/` | `e2-sizes.jsonl` |
| E3 | `results/E3/` | `e3-concurrency.jsonl` |
| E4 | `results/E4/` | `e4-impact.jsonl` |
| E5 | `results/E5/` | `e5-reads.jsonl` |
| E6-sidecar | `results/E6/` | see `e6-sidecar.arm-crud.jsonl` + `e6-sidecar.arm-registry.jsonl` (+ `e6-sidecar-runsheet-<runId>.json`) |

Driver scripts should default `--out` to `docs/evidence/perf/results/EX/<file>.jsonl` so reports, CSV, and raw logs stay one subtree.

## `data/`

`docs/evidence/perf/data/` is optional scratch space (not the home for E1–E6 canonical JSONL).

## Repro commands

Run inside **`api-gateway/`** (`cd api-gateway`). Prereqs: Node 18+, `api-gateway/.env` with chain certs and OTP reuse settings as in **`npm run perf:precheck`** (see gateway `README.md`).

**Suggested order** (canonical JSONL defaults under `results/EX/`; rebuild CSV/MD offline where marked):

| Step | Command |
|:----:|---------|
| P0 | `npm run perf:precheck` |
| E1 | `npm run perf:e1:full` · offline `npm run perf:e1:csv-from-jsonl`, `npm run perf:e1:md-from-jsonl` |
| E2 | `npm run perf:e2:payload-sanity` · `npm run perf:e2:full` · offline `perf:e2:csv-from-jsonl`, `perf:e2:md-from-jsonl` |
| E3 | `npm run perf:e3:full` · offline `perf:e3:csv-from-jsonl`, `perf:e3:md-from-jsonl` |
| E4 | `npm run perf:e4:chain-mock-sanity` · `npm run perf:e4:mock-sanity` · `npm run perf:e4:full` · offline `perf:e4:aggregate-from-jsonl`, `perf:e4:md-from-jsonl` |
| E5 | `npm run perf:e5:full` (needs `results/E1/e1-breakdown.jsonl`) · offline `perf:e5:aggregate-from-jsonl`, `perf:e5:md-from-jsonl` |
| E6-sidecar | `npm run perf:e6` (after P0); smoke `perf:e6:smoke`; offline `perf:e6:aggregate-from-jsonl` |

Smokes (fast checks): `npm run perf:e1:smoke`, `perf:e2:smoke`, `perf:e3:smoke`, `perf:e4:smoke`, `perf:e5:smoke`, `perf:e6:smoke`.

**Aggregates:** index page **`results/summary.md`** links each experiment report + CSV anchors.

---

## Threats to validity

- **Single deployment profile:** Results reflect one gateway build, chain RPC layout, OS disk, JVM, FISCO/WeBASE settings; throughput and percentile tails differ across hosts.
- **Synthetic payloads:** Harness-generated case JSON validates hashes but omits examiner-driven diversity; tiers (E2) interpolate padding, not real casework folders.
- **Sequential driver ordering (E6-sidecar):** The registry arm follows the CRUD arm on the same chain; both use disjoint `caseId` prefixes and record stores across **separate gateway processes**. Residual contention from shared chain mempool is intrinsic to comparing “without registry tx” versus “with registry tx” rather than eliminating all chain variables.
- **Mock chain (E4 variant B)** removes real consensus / registry reconciliation cost; deltas attribute “blockchain integration” only under the stubs described in **`e4-impact.md`** (not production timing).
- **Clock domains:** Gateway `timing` fields, `clientRoundTripMs`, and block timestamps stem from distinct clocks — align wording with **`docs/evidence/autopsy-upload/mapping.md`** (Section 5.4 wall-clock table) before claiming sub-second precision.
- **`MAIL_DRY_RUN` + OTP peek mode:** Harness forces dry-run mailing and reusable X-Auth-Token for long runs — removes SMTP noise but differs from hardened production mail policies.

Further driver flags and scratch paths: **`api-gateway/scripts/perf/README.md`**.

---

## Version control

Canonical **`results/E1/` … `results/E5/*.jsonl`**, **`results/*.csv`**, **`results/summary.md`**, and per-experiment **`e*.md`** are intended committed for reproducibility. If oversized JSONLs must leave git, selectively ignore under root **`.gitignore`** (comments only by default — see appended note).
