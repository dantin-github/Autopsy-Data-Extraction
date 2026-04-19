# Case API Gateway

Node.js / Express gateway: `/login` (police OTP + judge session), `POST /api/upload`, `POST /api/query`. Optional FISCO BCOS CRUD on `t_case_hash`.

## Requirements

- Node.js **18+**
- Copy **`.env.example`** → **`.env`** and set at least **`SESSION_SECRET`**.

## Setup

```powershell
cd api-gateway
npm install
npm run seed-users
```

Police / judge demo accounts are defined in **`data/users.example.json`** (passwords in the seed file; default is often `1` after seeding).

## Configuration (short)

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Required. Session signing. |
| `MAIL_DRY_RUN` | `1` = log OTP in server output, no SMTP. |
| `OTP_TTL_MS` | Police OTP lifetime (default 2 hours). |
| `RECORD_STORE_PATH` | Private JSON store (default: `%USERPROFILE%\.case_record_store.json`). |
| Chain | `conf/fisco-config.json` + `conf/accounts/gateway.pem` — see `.env.example`. |

## S3.7 smoke (6 checks, no separate server)

Runs **in-process** (Supertest): health, judge login, police OTP, **OTP replay rejected**, upload + query match, **tamper → query mismatch**. **Chain is mocked** so it works without a live node.

```powershell
cd api-gateway
npm run smoke
```

On success you should see `[1/6]` … `[6/6]` and `S3.7 smoke: all 6 checks passed.`

### PowerShell wrapper

```powershell
.\scripts\smoke.ps1
```

(Equivalent to `npm run smoke`.)

## Run the server

```powershell
npm run dev
```

Health: `GET http://localhost:3000/health`

## Tests

```powershell
npm test
```

## Manual E2E (real HTTP + optional real chain)

Use **`e2e-flow.ps1`** or the steps in comments there: police login → OTP from mail or dry-run log → `/api/upload` → judge login → `/api/query`. Real uploads need chain certs and a running FISCO peer group.

## Scripts (see `package.json`)

| Script | Purpose |
|--------|---------|
| `npm run seed-users` | Build `data/users.json` from `users.example.json` |
| `npm run ping-chain` | Block height (needs chain config) |
| `npm run smoke` | S3.7 acceptance smoke |
