# Thesis chapter → evidence mapping

Fill the **Section** column with your dissertation numbering. **Evidence** points to this repo or external assets.

| Section (edit) | Topic | Evidence location |
|----------------|-------|-------------------|
| §x.x | Hash-only model / `index_hash`–`record_hash` | `blockchain/README.md`, CRUD DDL in `blockchain-setup/` |
| §x.x | CaseRegistry contract (two-party workflow) | `docs/evidence/contracts/CaseRegistry.abi`, `api-gateway/contracts/CaseRegistry.sol` |
| §x.x | Positive chain flow (deploy → createRecord → propose → …) | WeBASE tx screenshots (`docs/evidence/webase/`), your saved `txHash` rows in `tx-hashes/positive-chain-template.csv` |
| §x.x | Contract negative cases (revert reasons) | `docs/evidence/tx-hashes/s4.4-negative.csv`, manifest `negative-cases/s4.4-manifest.jsonl` |
| §x.x | Gateway HTTP negative cases (`chainError`) | `docs/evidence/tx-hashes/s7.6-http-negative.csv`, `e2e-negative/s7.6-manifest.jsonl` |
| §x.x | API request/response samples | `docs/evidence/samples/` |
| §x.x | Off-chain audit trail (events → JSONL) | `api-gateway/data/audit.jsonl` (runtime; copy a snippet into `samples/audit-events.example.jsonl`) |
| §x.x | WeBASE / node explorer | `docs/evidence/webase/README.md` (screenshot checklist) |

**Figures (external):** add rows for each WeBASE screenshot filename you archive (e.g. thesis `figures/webase-proposal-executed.png`).
