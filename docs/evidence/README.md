# Dissertation evidence package (Phase 9)

This folder holds **reproducible artifacts** for the thesis: contract ABI, transaction hash lists, HTTP/API samples, and a **chapter → file** index. **WeBASE screenshots** are not stored in git; see `webase/README.md`.

| Path | Contents |
|------|----------|
| `contracts/CaseRegistry.abi` | Solidity `CaseRegistry` ABI (copy of `api-gateway/build/CaseRegistry.abi` at packaging time). Regenerate: `cd api-gateway && npm run compile -- contracts/CaseRegistry.sol`. |
| `tx-hashes/*.csv` | Curated hashes exported from test manifests (`negative-cases`, `e2e-negative`). Add your **live chain** positive hashes to `tx-hashes/positive-chain-template.csv`. |
| `samples/` | Example JSON for upload/query/audit (illustrative; replace with your captures). |
| `chapter-evidence-mapping.md` | Map thesis sections to files and figures. |
| `negative-cases/s4.4-manifest.jsonl` | S4.4 contract negative tests (from `npm test` when chain present). |
| `e2e-negative/s7.6-manifest.jsonl` | S7.6 HTTP negative tests (mock tx hashes in CI). |
| `autopsy-upload/` | Autopsy → gateway upload + **proposal flow** (`proposal-flow/` for P4: propose → approve → auto-execute evidence checklist). |

**Regenerate ABI copy after contract changes:**

```text
cd api-gateway
npm run compile -- contracts/CaseRegistry.sol
copy /Y build\CaseRegistry.abi ..\docs\evidence\contracts\CaseRegistry.abi
```

(PowerShell: `Copy-Item`.)
