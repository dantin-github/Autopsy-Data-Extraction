# Case API Gateway

Node.js / Express gateway: `/login` (police OTP + judge session), `POST /api/upload`, `POST /api/query`. Optional FISCO BCOS CRUD on `t_case_hash`.

**Thesis / evidence (Phase 9):** the repo root **`docs/evidence/`** holds an ABI copy, tx-hash CSVs, API samples, and a chapter→evidence mapping. WeBASE screenshots are documented in **`docs/evidence/webase/README.md`** (capture locally).

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
| `JSON_BODY_LIMIT` | Max JSON body for Express (default **`100mb`**). Full Autopsy exports exceed the old 2mb cap. |
| Chain | `conf/fisco-config.json` + `conf/accounts/gateway.pem` — see `.env.example`. |
| `CASE_REGISTRY_ADDR` | Set by **`npm run deploy-contract`** (S5.1) after compiling `CaseRegistry`. |
| `CHAIN_MODE` | **`contract`** (default) or **`crud`**. With **`CASE_REGISTRY_ADDR`** set, **`contract`** = `t_case_hash` insert + **`CaseRegistry.createRecord`** (needs **`signingPassword`** on upload). **`crud`** = table insert only (legacy / tests). |
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

**`CHAIN_MODE`** — **`contract`** (default): when **`CASE_REGISTRY_ADDR`** is set, **`POST /api/upload`** inserts into **`t_case_hash`** then **`chain.createCaseRegistryRecordFromKeystore`** (**`caseRegistryTx`**, S5.4); requires **`signingPassword`**. **`crud`**: table insert only (no CaseRegistry tx on upload).

**`npm run smoke`** runs **twelve** checks: six with **`CHAIN_MODE=contract`** (**CaseRegistry** mocked) plus six with **`CHAIN_MODE=crud`** (table-only path).

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

**Phase 6 S6.1 (case + Pending proposal):** from repo root, `python tests/seed_fixtures.py --gateway-dir api-gateway` (see **`tests/README.md`**). It runs `gen-e2e-upload-body` / `gen-e2e-propose-body`, upload + police session + propose, then verifies **`POST /api/query`** and **`GET /api/modify/:proposalId`** (Pending).

**Phase 6 S6.2 (pytest smoke):** `python tests/seed_fixtures.py --prepare-smoke --gateway-dir api-gateway` then `python -m pytest tests/smoke.py -v` (optional `SMOKE_POLICE_OTP` for the police role-gate assertion). Details in **`tests/README.md`**.

**Phase 6 S6.3 (HAR):** `python tests/record_gateway_har.py` (Playwright; see **`tests/requirements-har.txt`** and **`docs/evidence/judge-web/network/README.md`**).

**Phase 6 S6.4 (browsers):** Manual UI smoke in Chrome + Edge; notes in **`judge-web/README.md`** § Known limitations.

## Phase 7 · 链上修改提议 / 审批（S7.1–S7.6）手动验证

前提与 S7.1 相同：**`CHAIN_MODE=contract`**、**`CASE_REGISTRY_ADDR`** 已配置，**`conf/fisco-config.json`** + 证书可用，已 **`npm run compile -- contracts/CaseRegistry.sol`**、**`npm run deploy-contract`**、**`npm run seed-roles`**（警察 / 法官 **`onchainAddress`** 与 **`data/keystore/<userId>.enc`** 就绪）。网关 **`npm run dev`**。

下面用 **curl** 思路说明；你也可以用 Postman / 浏览器插件，只要带上 **Cookie**（警察或法官会话）或 **X-Auth-Token**（警察上传等）即可。

### S7.1（复习）：警察提议 → 法官读到 Pending

1. **`GET /health`** — 确认服务正常。
2. 警察：**`POST /login`**（`username` / `password`，警察账号）拿到 OTP 提示；若 **`MAIL_DRY_RUN=1`**，在终端日志里抄 OTP。
3. **`POST /api/auth/police-otp`** — body：`username`、`otp`。成功后会 Set-Cookie（警察会话），后续请求带该 Cookie。
4. 若链上还没有该案：**`POST /api/upload`**（需 **`X-Auth-Token`** + 与 **`CHAIN_MODE=contract`** 配套的 **`signingPassword`**），使 **`CaseRegistry`** 上存在该案记录。
5. **`POST /api/modify/propose`** — Cookie（警察）+ JSON：`caseId`、`caseJson`、`aggregateHash`、`examiner`、`generatedAt`、**`signingPassword`**、可选 **`proposalId`**（不传则网关随机）、**`reason`** 等。成功返回 **`proposalId`**、**`txHash`**、**`blockNumber`**。
6. 法官：**`POST /login`**，`Accept: application/json`，`username` / `password`（法官账号，如 **`judge1`** / **`1`**），拿到会话 Cookie。
7. **`GET /api/modify/<proposalId>`**（S7.5）— **任一已登录角色**（警察或法官 Cookie）。路径里 **`proposalId`** 为 64 位十六进制（可带或不带 **`0x`**）。成功时返回链上提案全貌：**`proposalId`**、**`status`**、**`proposer`**、**`approver`**、**`oldHash`** / **`newHash`**、**`reason`**、**`proposedAt`**、**`decidedAt`**（均为合约 **`getProposal`** 解码结果；Pending 时 **`approver`** 一般为 **`null`**，**`reason`** 为警察在 **`propose`** 时填写的说明）。

### S7.2：法官审批 → 链上 Approved

在 **S7.1 已完成且提案仍为 Pending** 的前提下：

1. 保持法官会话（同上 **`POST /login`** 拿到的 Cookie；或用同一浏览器会话）。
2. **`POST /api/modify/approve`** — Cookie（法官）+ JSON  body：
   - **`proposalId`**：上一步 **`propose`** 返回的 32 字节 hex（与 **`GET /api/modify/...`** 用的是同一个 ID）。
   - **`signingPassword`**：与 **`npm run seed-roles`** 加密法官 keystore 时使用的密码一致（通常与 `data/users.example.json` 里该用户的登录密码相同，如 **`1`**）。
3. 成功时响应含 **`txHash`**、**`blockNumber`**，以及可选的 **`proposalApproved`**（从收据事件解析的 **`proposalId`** / **`approver`** 地址）。
4. 再次 **`GET /api/modify/<proposalId>`**：**`status`** 应为 **`Approved`**，**`approver`** 为法官链上地址（与 **`users.json`** 里该法官的 **`onchainAddress`** 一致）。可在 **WeBASE** 里用 **`txHash`** 查看交易与事件 **`ProposalApproved`**。

说明：合约禁止 **提案人自己审批**（**`self approve`**）且仅 **Pending** 可批；重复审批或状态不对会返回 **4xx**（如 **`not pending`** → **409**）。法官 **`signingPassword`** 错误 → **401**。

### S7.3：法官驳回 → 链上 Rejected

在 **提案仍为 Pending** 的前提下（尚未 **approve**）：

1. **`POST /api/modify/reject`** — Cookie（法官）+ JSON body：**`proposalId`**、**`signingPassword`**、**`reason`**（驳回理由，**必填**；会写入合约 **`Proposal.reason`**，并发出 **`ProposalRejected`** 事件）。
2. 成功时响应含 **`txHash`**、**`blockNumber`**、**`reason`**（与请求一致），以及可选的 **`proposalRejected`**（事件解析）。
3. **`GET /api/modify/<proposalId>`**：**`status`** 应为 **`Rejected`**，**`approver`** 为法官地址，**`reason`** 为**驳回理由**（不再是提议阶段的说明）。

说明：与 **`approve`** 相同，禁止 **自批/自驳**（**`self reject`**）；非 **Pending** → **409**。

### S7.4：原提议警察执行 → 链上 Executed + 本地正式记录更新

在 **法官已 `approve`**、提案为 **Approved**，且网关 **`recordStore`** 里仍存在 **`{caseId}::pending-{proposalId}`** 待定稿的前提下：

1. **警察会话**（与 **`propose`** 同一账号：`POST /login` → `POST /api/auth/police-otp`）。
2. **`POST /api/modify/execute`** — JSON：**`proposalId`**、**`signingPassword`**（`seed-roles` 对应警察 keystore）。
3. 成功：响应 **`txHash`**、**`blockNumber`**、**`caseId`**、**`pendingKey`**；可选 **`proposalExecuted`**（事件 **`ProposalExecuted`**）；以及 **`crudTxHash` / `crudBlockNumber`**（表 **`t_case_hash`** 与本地新记录对齐）。网关对 **`t_case_hash`** 的 **`update`** 会 **自动重试**（间隔约 0 / 250 / 750 / 1500 ms）。链上 **`CaseRegistry`** 的 **`record_hash`** 已更新；本地 **`caseId`** 主键由待定稿覆盖，**`pending`** 键删除。若 CRUD 在重试后仍失败，响应含 **`crudUpdateWarning`**、**`crudSyncHint`**（合约与本地已提交）。
4. **补偿**：警察会话 **`POST /api/modify/sync-crud-mirror`**，JSON **`{"caseId":"<caseId>"}`**，按 **`CaseRegistry.getRecordHash`** 再写 **`t_case_hash`**（与 execute 后手动对齐镜像）。
5. **`POST /api/query`**（法官）：**`recordHashMatch`** 以 **CaseRegistry** 为准（CRUD 滞后时仍可与本地一致）；若 **`integrity.crudRegistryOutOfSync`** 为 true，应执行上一步或排查链。

说明：部分 FISCO 版本下 CRUD 按主键 **`index_hash`** 的 **`select`** 不可靠；网关使用 **`getMirroredRecordHash`**（校验行上 **`index_hash`**、必要时按 **`record_hash`** 列回查）并对链上返回的畸形 hex **跳过**该行，减少误报蓝条与 **`/api/query` 500**。上传成功后在合约模式下会对 Registry/CRUD 做一次对账写入。过程记录见仓库 **`docs/project-progress.md`**。

若本地无待定条目 → **400** `PENDING_SNAPSHOT_NOT_FOUND`。合约侧：**非 Approved**、**非原 proposer**、或链上 **`record_hash` 已变** → **4xx**（见 `EXECUTE_FAILED`）。

#### 7.4 全流程复核 + 审计日志（推荐按序执行）

目标：在**真链**上跑通 **upload → propose → approve → execute**，再用 **`GET /api/audit`** / **`data/audit.jsonl`** 看到 **`RecordCreated`**、**`ProposalCreated`**、**`ProposalApproved`**、**`ProposalExecuted`**（upload 与建案对应 **`RecordCreated`**）。

**准备（一次性）**

1. **`.env`**：`SESSION_SECRET`、`CHAIN_MODE=contract`、`CASE_REGISTRY_ADDR`、`MAIL_DRY_RUN=1`（OTP 打日志）、`FISCO_CONFIG` / 证书 / **`gateway.pem`**。
2. **`npm run compile -- contracts/CaseRegistry.sol`** → **`npm run deploy-contract`** 写入合约地址。
3. **`npm run seed-users`** → **`npm run seed-roles`**（警察/法官 **`onchainAddress`** + keystore；登录/签名密码示例为 **`1`**）。
4. **先起网关再跑交易**：**`npm run dev`**。`eventListener` 首次运行会把 **`lastBlockSeen`** 设为当前块高，**只扫之后的新块**；因此要在网关已启动后再发交易。可选：清空 **`data/audit.jsonl`** 便于阅读（不要误删正在用的 **`data/users.json`**）。等 **~5s** 让第一轮轮询完成后再发下一笔。

**步骤（同一终端，目录均为 `api-gateway`）**

1. **生成上传体**（新 `caseId`）：`node scripts/gen-e2e-upload-body.js`  
   已包含 **`signingPassword: "1"`**（与 **`seed-roles`** 一致；若你改了密码请改 JSON）。

2. **警察 OTP**：`curl -s -X POST http://localhost:3000/login -H "Content-Type: application/json" -H "Accept: application/json" -d "{\"username\":\"officer1\",\"password\":\"1\"}"`  
   在终端日志里找到 **16 位 hex OTP**（`MAIL_DRY_RUN`）。

3. **上传**：`curl -s -X POST http://localhost:3000/api/upload -H "Content-Type: application/json" -H "X-Auth-Token: <上一步OTP>" --data-binary @e2e-upload-body.json`  
   确认返回 **200** 且链上 **`CaseRegistry`** 已建案。

4. **生成提议体**（依赖上一步写入的 **`recordStore`**，路径须与网关一致，默认 **`~/.case_record_store.json`**）：`node scripts/gen-e2e-propose-body.js`  
   生成 **`e2e-propose-body.json`**。

5. **警察会话 Cookie**（与测试一致）：先 **`POST /login`** 再 **`POST /api/auth/police-otp`**（body：`username`、`otp`）。可用浏览器登录页，或用 curl 保存 **`cookies.txt`**。

6. **提议**：`curl -s -b cookies.txt -X POST http://localhost:3000/api/modify/propose -H "Content-Type: application/json" --data-binary @e2e-propose-body.json`  
   记下返回的 **`proposalId`**。

7. **法官登录**：`curl -s -c judge.txt -X POST http://localhost:3000/login -H "Content-Type: application/json" -H "Accept: application/json" -d "{\"username\":\"judge1\",\"password\":\"1\"}"`

8. **审批**：`curl -s -b judge.txt -X POST http://localhost:3000/api/modify/approve -H "Content-Type: application/json" -d "{\"proposalId\":\"<proposalId>\",\"signingPassword\":\"1\"}"`

9. **执行**（再换警察 Cookie）：`curl -s -b cookies.txt -X POST http://localhost:3000/api/modify/execute -H "Content-Type: application/json" -d "{\"proposalId\":\"<proposalId>\",\"signingPassword\":\"1\"}"`

10. **等 ~5～10 秒**（多轮区块轮询），然后：  
    - **`Get-Content .\\data\\audit.jsonl`**（Windows），或  
    - **`curl -s -b judge.txt "http://localhost:3000/api/audit?limit=30"`**

若 **`audit.jsonl` 仍为空**：确认 **`CASE_REGISTRY_ADDR`** 与链上部署一致、网关日志无 **`eventListener: skipped`**，且交易发生在 **`npm run dev` 启动之后**的新块里。

### S7.6：负向 HTTP + `chainError`

合约 **`propose` / `approve` / `reject` / `execute`** 若交易回滚（receipt 失败），网关返回 **4xx**（常见 **409** 冲突、**403** 禁止），JSON body 含 **`error`**（人类可读）以及 **`chainError.revertReason`**（与合约 **`require`** 字符串一致，若能从 receipt 解码）和 **`chainError.txHash`**（失败交易的哈希）。

**`npm test`** 中的 **`test/e2e-modify-negative.test.js`** 用 HTTP 覆盖四条负向路径并每次重写证据清单 **`docs/evidence/e2e-negative/s7.6-manifest.jsonl`**（含场景名、HTTP 状态、`revertReason`、`txHash`；测试中使用模拟失败时的占位 txHash，真链联调时由实际回滚交易替换）。

## Phase 8 · 事件审计流（S8.1 / S8.2）

前提：**`CHAIN_MODE=contract`**、**`CASE_REGISTRY_ADDR`**、**`conf/fisco-config.json`** + **`gateway.pem`**，已 **`npm run compile`**，合约 ABI 在 **`build/CaseRegistry.abi`**。

### S8.1 · `eventListener`（`src/services/eventListener.js`）

- 网关进程启动（**`npm start`** / **`npm run dev`**）后，若链配置齐全且 **`CASE_REGISTRY_ADDR`** 已设置，则每 **`EVENT_LISTENER_POLL_MS`**（默认 **5000**）轮询新区块，扫描 **`CaseRegistry`** 合约 receipt 中的 **`RecordCreated`**、**`ProposalCreated`**、**`ProposalApproved`**、**`ProposalRejected`**、**`ProposalExecuted`**，以 JSON 行追加写入 **`data/audit.jsonl`**（可通过 **`AUDIT_LOG_PATH`** 覆盖）。
- 进度保存在 **`data/audit-state.json`**（**`lastBlockSeen`**）。首次启动会将 **`lastBlockSeen`** 设为当前块高（不追溯历史块）；若需从更早块重扫，可停网关后删除该状态文件再启动。
- 关闭轮询：**`ENABLE_EVENT_LISTENER=0`**。

跑完 Phase 7 的正向上链流程后，**`data/audit.jsonl`** 应至少新增 **4** 行（与 **`ProposalCreated` … `ProposalExecuted`** 等事件对应）。

本地**无链**时想先看审计文件长什么样：在 **`api-gateway`** 目录执行 **`npm run simulate-audit`**（会**追加** 4 行模拟事件；若要先清空再写，用 **`npm run simulate-audit -- --reset`**）。再 **`GET /api/audit`**（法官）或打开 **`data/audit.jsonl`**（与 `eventListener` 写入格式一致）。

### S8.2 · `GET /api/audit`

- **法官会话** Cookie；查询参数：**`limit`**（默认 **50**，最大 **500**）、**`since`**（ISO 时间或 Unix 毫秒整数，只返回该时刻及之后的行）。
- 返回 JSON：**`items`**（按 **`blockNumber`** / **`logIndex`** **倒序**，即最新在前）、**`limit`**。
- 性能：**`test/audit.test.js`** 对约 **1000** 行 JSONL 做 **`readAuditLines`** 抽样，满足 **p95 under 200ms** 的本地验收。

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
