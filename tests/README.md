# Phase 6 · Test helpers

## S6.1 · `seed_fixtures.py`

Seeds **one case on chain** (via `POST /api/upload`) and **one Pending modify proposal** (via `POST /api/modify/propose`), then checks **`POST /api/query`** and **`GET /api/modify/:proposalId`** with a judge session.

### Prerequisites

- **api-gateway** running (`npm run dev` in `api-gateway/`), with **`CHAIN_MODE=contract`**, **`CASE_REGISTRY_ADDR`**, FISCO config + certs, **`MAIL_DRY_RUN=1`** recommended (OTP appears in the gateway terminal log).
- **`npm run seed-users`** / **`npm run seed-roles`** done (police **`officer1`** / judge **`judge1`**, password **`1`** in the sample data).
- **Same `RECORD_STORE_PATH`** as the gateway when generating the propose body (default: `%USERPROFILE%\.case_record_store.json` on Windows, `~/.case_record_store.json` elsewhere). If the gateway uses a custom path, set the same variable for the Node scripts, e.g.  
  `set RECORD_STORE_PATH=D:\path\to\store.json` (PowerShell: `$env:RECORD_STORE_PATH=...`).

### Install (once)

```powershell
cd tests
python -m pip install -r requirements.txt
```

### Run

From repository root:

```powershell
python tests\seed_fixtures.py --gateway-dir api-gateway
```

The script will:

1. Run `node scripts/gen-e2e-upload-body.js` (creates `api-gateway/e2e-upload-body.json`, `e2e-query-body.json`).
2. Ask for **upload OTP** (first police login — check gateway log).
3. `POST /api/upload` with `X-Auth-Token`.
4. Ask for **session OTP** (second police login).
5. `POST /api/auth/police-otp` (police cookie).
6. Run `node scripts/gen-e2e-propose-body.js`.
7. `POST /api/modify/propose` with `e2e-propose-body.json`.
8. Judge login, then verify **query** + **modify** endpoints.

Non-interactive OTP (e.g. automation): set environment variables **`SEED_OTP_UPLOAD`** and **`SEED_OTP_SESSION`** (each from a fresh `POST /login` as `officer1`).

On success, **`tests/.seed_fixture_result.json`** is written with `caseId`, `proposalId`, and `baseUrl` for later smoke tests.

### Curl checks (manual)

After a successful run, create a judge cookie jar (same host as `--base-url`), then:

```powershell
curl -s -c judge-cookies.txt -X POST http://localhost:3000/login -H "Content-Type: application/json" -H "Accept: application/json" -d "{\"username\":\"judge1\",\"password\":\"1\"}"
curl -s -b judge-cookies.txt -X POST http://localhost:3000/api/query -H "Content-Type: application/json" --data-binary "@api-gateway/e2e-query-body.json"
curl -s -b judge-cookies.txt http://localhost:3000/api/modify/<proposalId>
```

Use the `proposalId` printed by the script or read `tests/.seed_fixture_result.json`.

---

## S6.2 · `smoke.py` (pytest + requests)

Seven HTTP checks against a **running** api-gateway:

| # | Check |
|---|--------|
| 1 | Judge `POST /login` JSON → `role=judge` |
| 2 | `POST /api/query` → `recordHashMatch` / `aggregateHashValid` |
| 3 | Tamper local `RECORD_STORE_PATH` row → mismatch → restore |
| 4 | `POST /api/modify/approve` (case A proposal) |
| 5 | `POST /api/modify/reject` (case B proposal) |
| 6 | `GET /api/audit?limit=50` → at least **`SMOKE_AUDIT_MIN`** rows (default **4**) |
| 7 | Police `POST /api/auth/police-otp` then `POST /api/query` → **401** |

### One-time: generate `smoke_config.json`

From repo root (gateway must be up; you will paste **four** 16-hex OTPs from `MAIL_DRY_RUN` logs — two per case):

```powershell
python -m pip install -r tests/requirements.txt
python tests/seed_fixtures.py --prepare-smoke --gateway-dir api-gateway
```

This writes **`tests/smoke_config.json`** (gitignored). Use the same host in the config as you use for login (`127.0.0.1` vs `localhost` matters for cookies if you mix them).

Non-interactive OTPs for case A/B: set **`SEED_A_OTP_UPLOAD`**, **`SEED_A_OTP_SESSION`**, **`SEED_B_OTP_UPLOAD`**, **`SEED_B_OTP_SESSION`**.

### Role-gate test (7th)

1. `POST /login` as `officer1` with `Accept: application/json` (do **not** consume the OTP yet).
2. Copy the new 16-hex OTP from the gateway log.
3. PowerShell: `$env:SMOKE_POLICE_OTP='xxxxxxxxxxxxxxxx'`
4. Immediately: `python -m pytest tests/smoke.py -v` (OTP TTL is short).

If you omit `SMOKE_POLICE_OTP`, test 7 is **skipped** (the other six still run).

### Run smoke

```powershell
python -m pytest tests/smoke.py -v
```

Looser audit threshold (e.g. dev chain without many events yet):

```powershell
$env:SMOKE_AUDIT_MIN='1'
python -m pytest tests/smoke.py -v
```

**Note:** Approve/reject mutate chain state. Regenerate **`smoke_config.json`** before a second full run.

