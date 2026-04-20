# WeBASE (optional figures)

Screenshots **cannot** be generated inside this repo. After transactions on your chain, capture at least:

1. **Transaction detail** — hash, block, status `Success`, **input/output** if shown.
2. **Event logs** — for `RecordCreated`, `ProposalCreated`, `ProposalApproved`, `ProposalExecuted` (contract address = `CASE_REGISTRY_ADDR`).
3. **Contract** — `CaseRegistry` at deployed address, ABI verified if your tool supports it.

**Suggested filenames** (save under your thesis `figures/`, not necessarily here):

- `webase-create-record.png`
- `webase-proposal-created.png`
- `webase-proposal-approved.png`
- `webase-proposal-executed.png`

Link these filenames in `chapter-evidence-mapping.md`.
