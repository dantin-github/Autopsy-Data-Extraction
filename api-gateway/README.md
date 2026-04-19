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
| `CASE_REGISTRY_ADDR` | Set by **`npm run deploy-contract`** (S5.1) after compiling `CaseRegistry`. |
| `CHAIN_MODE` | **`crud`** (default) or **`contract`**. **`contract`** + **`CASE_REGISTRY_ADDR`** = dual write CRUD + **`CaseRegistry.createRecord`** (needs **`signingPassword`** on upload). |
| `UPLOAD_USE_CASE_REGISTRY` | Legacy **`1`** = same contract path as **`CHAIN_MODE=contract`** when address is set. |

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

## Phase 4 · Solidity toolchain (S4.1)

Uses **`solc@0.5.10`** (devDependency). Example:

```powershell
npm run compile -- contracts/HelloWorld.sol
```

Outputs **`build/HelloWorld.abi`** and **`build/HelloWorld.bin`** (generated; `build/` is gitignored). Acceptance is covered by **`npm test`** (`compile-hello.test.js`).

## Phase 4 · CaseRegistry draft (S4.2)

**`contracts/CaseRegistry.sol`** — two-party approval state machine + hash registry (§11.2). Compiled with the same **`solc@0.5.10`** toolchain; **no `Table.sol`** in this draft (in-contract `mapping` only) so it builds offline; Phase 6 may wire FISCO Table for `t_case_hash`.

```powershell
npm run compile -- contracts/CaseRegistry.sol
```

Produces **`build/CaseRegistry.{abi,bin}`**. **`npm test`** includes **`compile-case-registry.test.js`** (11 ABI functions including `getProposal`, 5 events).

## Phase 4 · Contract positive integration (S4.3)

With **`conf/fisco-config.json`** + **`conf/accounts/gateway.pem`** present, **`test/contract-positive.test.js`** deploys **`CaseRegistry`** to your FISCO group, registers two ephemeral **`ecrandom`** accounts as police/judge, then runs **`createRecord` → `propose` → `approve` → `execute`**, checks receipt **`status`** success, parses **`RecordCreated` / `ProposalCreated` / `ProposalApproved` / `ProposalExecuted`**, and asserts **`getProposal` / `getRecordHash`** fields.

Set **`CONTRACT_POSITIVE=0`** to skip this test (e.g. CI without a node). If config/certs are missing, the test skips automatically (same idea as the chain CRUD test).

## Phase 4 · Contract negative cases (S4.4)

**`test/contract-negative.test.js`** runs **six** guarded reverts (non-police `createRecord`, non-judge `approve`, execute without approve, duplicate `proposalId`, self-approve, non-proposer `execute`). Each transaction must **fail with non-zero receipt status** and a **decoded Solidity `Error(string)`** matching the contract `require` message. Evidence (**`txHash`**, status, reason) is appended to **`docs/evidence/negative-cases/s4.4-manifest.jsonl`** at repo root (file is recreated each run).

Set **`CONTRACT_NEGATIVE=0`** to skip. Requires the same chain config as S4.3.

## Phase 5 · Deploy CaseRegistry (S5.1)

Deploys **`CaseRegistry`** with the **`gateway`** account (same PEM as CRUD), then appends or updates **`CASE_REGISTRY_ADDR=0x...`** in **`.env`** (create the file if missing). Prints JSON with **`contractAddress`**, **`transactionHash`**, **`blockNumber`**.

```powershell
cd api-gateway
npm run deploy-contract
```

Use **`--no-compile`** if `build/CaseRegistry.{abi,bin}` are already fresh; **`--force`** to deploy again when `CASE_REGISTRY_ADDR` is already set; **`--env path`** to write a file other than `.env`.

In **WeBASE**, find the deploy transaction by hash, or **import contract** using **`build/CaseRegistry.abi`** and the printed address so **Transaction Info** shows decoded function names instead of `(null)`.

## Phase 5 · Keystore (S5.2)

**`src/services/keystore.js`** — **`scrypt`** (password + salt) derives a 32-byte key, **`aes-256-gcm`** encrypts the 32-byte secp256k1 private key. **`generateKeypair()`** uses **`ethers.Wallet.createRandom()`** (same stack as `fisco-bcos`). **`encrypt` / `decrypt`** return or accept a small JSON object (`version`, `salt`, `iv`, `tag`, `ciphertext`). Wrong password or tampering throws **`BadPassword`**.

Encrypted files for users land under **`data/keystore/<userId>.enc`** in S5.3; `*.enc` is gitignored.

**`npm test`** includes **`test/keystore.test.js`** (round-trip, wrong password, distinct ciphertexts).

## Phase 5 · Role keystore + on-chain registration (S5.3)

**`scripts/seed-roles.js`** — for each row in **`data/users.json`**, generates a secp256k1 keypair, encrypts the private key with that user’s login password (looked up from **`data/users.example.json`** by **`userId`** / **`passwordPlain`** — same source as **`npm run seed-users`**), writes **`data/keystore/<userId>.enc`**, then calls **`CaseRegistry`** **`addPolice`** / **`addJudge`** as the **`gateway`** owner and appends **`onchainAddress`** to **`users.json`**.

**Prerequisites:** **`npm run seed-users`**; **`npm run compile -- contracts/CaseRegistry.sol`**; **`npm run deploy-contract`** (sets **`CASE_REGISTRY_ADDR`**); **`conf/fisco-config.json`** + **`conf/accounts/gateway.pem`**.

```powershell
cd api-gateway
npm run seed-roles
```

**`--keystore-only`** — only writes **`*.enc`** files and **`onchainAddress`** in **`users.json`** (no ABI or chain; useful offline). **`--help`** prints usage. **`USERS_FILE`** / **`USERS_EXAMPLE_FILE`** override the default JSON paths.

**`npm test`** includes **`test/seed-roles.test.js`** (`--help` + **`--keystore-only`** smoke with temp files).

## Phase 5 · CaseRegistry upload signing (S5.4)

**`src/services/caseRegistryTx.js`** — after the usual **`t_case_hash`** CRUD insert succeeds, optionally calls **`CaseRegistry.createRecord`** using the police user’s **`data/keystore/<userId>.enc`** (decrypted with **`signingPassword`** in the JSON body) and a temporary FISCO **`ecrandom`** account (same pattern as contract integration tests).

Enable with **`CHAIN_MODE=contract`** (or legacy **`UPLOAD_USE_CASE_REGISTRY=1`**) and a valid **`CASE_REGISTRY_ADDR`**. **`POST /api/upload`** must then include **`signingPassword`** (login password used when **`npm run seed-roles`** encrypted the key). On success the JSON response adds **`caseRegistryTxHash`** and **`caseRegistryBlockNumber`**. Wrong password → **401**; duplicate **`indexHash`** on the contract → **409** (local store is rolled back; the CRUD row may still exist — see code comments).

**`npm test`** includes **`test/caseRegistryTx.test.js`** (bytes32 normalization).

## Phase 6 · CHAIN_MODE + smoke regression (S6.1 / S6.2)

**`CHAIN_MODE`** — **`crud`** (default): **`POST /api/upload`** only inserts into **`t_case_hash`**. **`contract`**: after CRUD, **`chain.createCaseRegistryRecordFromKeystore`** delegates to **`caseRegistryTx`** (same as S5.4). Configure **`CASE_REGISTRY_ADDR`** and **`signingPassword`** on upload.

**`npm run smoke`** runs **twelve** checks: the original six (**`CHAIN_MODE=crud`**) plus the same six with **`CHAIN_MODE=contract`** and **`CaseRegistry`** calls **mocked** (no live signing).

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
| `npm run seed-roles` | S5.3 keystore + `onchainAddress`; chain register police/judge on `CaseRegistry` |
| `npm run verify-case-registry-roles` | S5.5 on-chain `police`/`judges` flags vs `users.json` (no Java Console) |
| `npm run ping-chain` | Block height (needs chain config) |
| `npm run smoke` | S3.7 acceptance smoke |
| `npm run compile -- contracts/<Name>.sol` | S4.x Solidity → `build/<Name>.{abi,bin}` (HelloWorld / CaseRegistry) |
| `npm run deploy-contract` | S5.1 deploy `CaseRegistry` → **`CASE_REGISTRY_ADDR`** in `.env` |
