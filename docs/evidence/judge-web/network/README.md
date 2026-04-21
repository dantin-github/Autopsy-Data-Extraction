# Network evidence (Phase 6 S6.3)

## Why two different “network” views?

- **Judge Web (`judge-web`, Streamlit on :8501)** — The browser talks mainly to the Streamlit server (`_stcore/stream`, HTTP polling). The browser does **not** call `http://localhost:3000/api/...` directly; the Streamlit process does, using `requests` and the judge session cookie mirror.
- **API Gateway (`api-gateway`, :3000)** — Judicial REST endpoints (`/login`, `/api/query`, `/api/modify/*`, `/api/audit`) live here.

For thesis / appendix material that must show **concrete `/api/*` URLs**, use either:

1. **Automated HAR (recommended)** — `tests/record_gateway_har.py` drives Chromium against `http://127.0.0.1:3000` and writes a standard HAR (see below).
2. **Chrome DevTools (manual)** — Export HAR while performing operations; see the next section.

## Automated capture (same gateway calls as the dashboard)

Prerequisites: `tests/smoke_config.json` from `python tests/seed_fixtures.py --prepare-smoke ...`, api-gateway running, and a **still-Pending** proposal for the approve step (run this script **before** `pytest tests/smoke.py` if you use the default approve id from `smoke_config.json`).

```powershell
python -m pip install -r tests/requirements-har.txt
playwright install chromium
python tests/record_gateway_har.py --out docs/evidence/judge-web/network/approve-flow.har
```

The HAR includes at least: **`POST /login`**, **`POST /api/query`**, **`GET /api/modify/...`**, **`POST /api/modify/approve`**, **`GET /api/audit`**.

**Security:** HAR files may contain session cookies. Do not publish live sessions; redact or regenerate before public release.

## Manual Chrome DevTools export

### A) Gateway REST only (matches `/api/*` list)

1. Open **`http://127.0.0.1:3000/login`** (or your gateway base URL).
2. DevTools → **Network** → enable **Preserve log**.
3. In the **Console**, run fetches (adjust body JSON to your case):

```javascript
await fetch('/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ username: 'judge1', password: '1' }),
});
await fetch('/api/query', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ caseId: 'YOUR_CASE_ID' }),
});
// … approve, audit, etc.
```

4. Right-click the network table → **Save all as HAR with content**.

### B) Streamlit dashboard (:8501)

1. Open **`http://127.0.0.1:8501`**, log in, run Query, download JSON/PDF, Judicial Review, Audit.
2. Export HAR from DevTools — entries will be mostly **Streamlit** endpoints, not raw `api-gateway` paths. Use this to show **UI–server** behaviour; pair with (A) or the automated script for **`/api/*`** proof.

## Sample HAR

`approve-flow.sample.har` is a **minimal structural example** (placeholder timings/IDs). Replace with output from `record_gateway_har.py` for real evidence.
