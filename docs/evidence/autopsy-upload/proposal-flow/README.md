# Autopsy modification proposal → judge approve → auto-execute (P4 evidence)

Artifacts for the thesis **two-party modification** narrative: police **propose** from Autopsy (`POST /api/modify/propose-with-token`), judge **approve** on the dashboard, gateway **executor** auto-**execute** (P2), CRUD mirror aligned.

| Path | Purpose |
|------|---------|
| [mapping.md](mapping.md) | Claims ↔ files, tx hashes, audit events |
| [samples/](samples/) | Redacted JSON shapes (`proposal_receipt.json`, query-after-execute, …) |
| [screens/](screens/) | Your screenshots: settings (proposal mode), receipt, judge approve, `Executed` |

**Prerequisites**

- `api-gateway` running with P2 auto-execute enabled (`ENABLE_EVENT_LISTENER`, executor env — see gateway `.env.example`).
- Patched core built: repo root `build-patch-core.bat` → `patch\org-sleuthkit-autopsy-core-patched.jar`.
- **Install:** close Autopsy → run **`install-patch-core.bat` as Administrator** → restart Autopsy; if UI is stale, clear `%LOCALAPPDATA%\autopsy\Cache\dev` (script does part of this).

---

## End-to-end checklist (minimum three runs)

Repeat for **three** distinct case IDs (or the same case through upload → propose → approve cycles as appropriate).

### Round A — First on-chain record (upload)

1. Report module: enable **Upload after save** (not proposal). Valid gateway URL, OTP, signing password. **Test Connection** OK.
2. **Generate Report**. Confirm `CaseDataExtract/upload_receipt.json` and successful completion message.
3. Capture: optional screenshot of settings + Monitor; save `txHash` / `caseRegistryTxHash` for the thesis table.

### Round B — Modification proposal (Autopsy)

1. Report module: enable **Submit as modification proposal** (upload unchecked). Fill **Reason**, same OTP/signing as police.
2. **Generate Report** (changed content so aggregate hash changes). Confirm `CaseDataExtract/proposal_receipt.json` with `proposalStatus: success` and `proposalId`.
3. **Judge / auditor:** `GET /api/modify/<proposalId>` (session) → `Pending`.

### Round C — Approve and auto-execute

1. Judge approves via dashboard: `POST /api/modify/approve`.
2. Wait **~5–15 s** (listener + chain). Confirm:
   - `GET /api/modify/<proposalId>` → `status: Executed`.
   - `POST /api/query` for that `caseId` → `integrity.crudRegistryOutOfSync: false`, record hash matches new proposal.
3. **Evidence to file here:**
   - `samples/modify-approve-response.json` (redacted) — judge HTTP response if captured.
   - `samples/query-after-execute.json` (redacted) — query body after execute.
   - `audit-excerpt.jsonl` or note **two** tx hashes: judge **approve**, executor **execute**.
   - Screens under `screens/` per [mapping.md](mapping.md).

### Negative / guidance (optional fourth run)

- Attempt **Upload after save** when case already exists → operator message points to **proposal** mode; screenshot for thesis.

---

## File naming (suggested)

```
screens/
  p4-settings-proposal.png
  p4-proposal-receipt.png
  p4-judge-approved.png
  p4-query-executed.png
samples/
  proposal_receipt-success-example.json
  query-after-execute.example.json
```

Redact tokens, passwords, and internal hostnames before publication.
