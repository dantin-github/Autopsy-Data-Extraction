# Screen evidence (`screens/`)

Phase **S7.1** expects **PNG** captures for the Data Presentation Dashboard. The committed files are **placeholders** (title + caption on a dark background). Before final thesis submission, replace each with a **real screenshot** from Streamlit at `http://127.0.0.1:8501` (or your deployment URL).

| File | Capture scenario |
|------|-------------------|
| `login.png` | Login form before session is established. |
| `role-gate-police-rejected.png` | Police OTP / police user rejected (403 or inline error). |
| `query-ok.png` | Query tab — successful load, green integrity badges. |
| `query-tampered-diff.png` | Query tab — tampered / mismatched record (diff or red state). |
| `report-json-sample.png` | JSON report download control or exported `.json` in an editor. |
| `report-pdf-rendered.png` | Exported PDF open in a viewer. |
| `judicial-pending.png` | Judicial Review — at least one Pending proposal. |
| `judicial-approved.png` | After Approve — success state with chain fields if shown. |
| `judicial-rejected.png` | After Reject — reason visible. |
| `audit-normal.png` | Audit Trail — populated table. |
| `audit-open-in-review.png` | Audit Trail — row selected or cross-tab context into review. |

Regenerate placeholders (optional):

```powershell
python docs/evidence/judge-web/build_evidence_artifacts.py
```
