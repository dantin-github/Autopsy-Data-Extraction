# Judge Web — thesis chapter → evidence mapping (S7.1)

Each row ties a **claim or section** in the dissertation (CN/EN) to a **file under this folder** or a **short procedure**. Replace placeholder PNGs under `screens/` with real Streamlit captures before binding the final thesis PDF.

| Thesis topic / sentence (draft) | Evidence file or procedure |
|--------------------------------|----------------------------|
| Serves judges and auditors; role separation | `screens/login.png`, `screens/role-gate-police-rejected.png`; `tests/smoke.py` police OTP gate |
| Hash-indexed evidence query | `screens/query-ok.png`; `samples/verification_report.json` → fields `chain.indexHash`, `chain.recordHash` |
| Tampering / integrity failure UX | `screens/query-tampered-diff.png` |
| Verification report (machine-readable) | `samples/verification_report.json`; validate with `python docs/evidence/judge-web/verify_sample.py` |
| Verification report (human-readable PDF) | `samples/verification_report.pdf`; `screens/report-pdf-rendered.png` |
| Python + Streamlit implementation | `judge-web/requirements.txt`, `judge-web/app.py`; `screens/login.png` |
| HTTP access without browser-side blockchain SDK | Plan §4 sequence; `judge-web/services/gateway_client.py`; `network/approve-flow.har` (gateway `/api/*` only) |
| Technical translator (hashes → report) | `screens/report-json-sample.png`, `samples/verification_report.pdf` |
| Auditability / Audit Trail | `screens/audit-normal.png`, `screens/audit-open-in-review.png`; sample lines in `api-gateway/data/audit.jsonl` (local run) |
| Two-party judicial review | `screens/judicial-pending.png`, `screens/judicial-approved.png`, `screens/judicial-rejected.png`; on-chain tx hashes in live responses (WeBASE evidence under `docs/evidence/webase/`) |
| Defence in depth (UI + API) | `screens/role-gate-police-rejected.png`; `api-gateway` `requireJudgeSession` on `/api/audit` and modify routes |

## Network capture

| Artifact | Notes |
|----------|--------|
| `network/approve-flow.har` | Committed copy synced from `approve-flow.sample.har`; regenerate via `python tests/record_gateway_har.py --out docs/evidence/judge-web/network/approve-flow.har` on a trusted machine. Redact cookies before public release. |
| `network/README.md` | Automated vs manual HAR instructions (Phase S6.3). |

## Regenerating this pack

```powershell
pip install -r docs/evidence/judge-web/requirements-build.txt
python docs/evidence/judge-web/build_evidence_artifacts.py
python docs/evidence/judge-web/verify_sample.py
```
