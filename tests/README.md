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
