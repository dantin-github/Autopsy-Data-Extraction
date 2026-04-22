# Thesis ↔ evidence (Autopsy proposal flow + auto-execute)

Use when writing the **modification workflow** section: police propose → judge approve → **system executor** completes `execute` without a second police action.

## Actors (on-chain audit narrative)

| Role | Typical artifact |
|------|------------------|
| Proposer (police) | Autopsy `proposal_receipt.json` → `proposalId`, `txHash` (propose tx) |
| Approver (judge) | Dashboard approve; audit / receipts → approve `txHash` |
| Executor (gateway `system-executor`) | Audit `ProposalExecuted` event; execute `txHash` |

## Claims → evidence

| Claim | Evidence |
|--------|----------|
| Autopsy submits proposals over HTTP with OTP | `GatewayClient.proposeModification`; `proposal_receipt.json`; gateway log `propose-with-token` |
| Judge does not run `execute`; gateway does after approve | Two transactions: approve vs execute; `GET /api/modify` shows `Executed` without police `POST /api/modify/execute` |
| Registry + CRUD + local mirror consistent after execute | `POST /api/query` → `recordHashMatch`, `crudRegistryOutOfSync: false` |
| Idempotence / no double execute | Same `proposalId` single `Executed`; `data/executor-cursor.json` (deployment note, redact paths) |

## Figure checklist (proposal chapter)

1. Report settings: **Submit as modification proposal** + Reason field (non-sensitive).
2. `proposal_receipt.json` (redacted) with `proposalId` and `txHash`.
3. Judge dashboard (or API capture): proposal **Pending** → after approve, chain/audit showing **ProposalApproved** then **ProposalExecuted**.
4. Query panel or JSON: **`Executed`** and integrity badges green.
5. Optional: stuck **Approved** troubleshooting note (listener off, missed block) — only if you document failure modes.

## Cross-links

- Parent pack: [../README.md](../README.md)
- Gateway / plan: repo Cursor plan *autopsy-modify-reupload-flow* (P2 auto-execute, P3 Autopsy UI, P4 this folder)
