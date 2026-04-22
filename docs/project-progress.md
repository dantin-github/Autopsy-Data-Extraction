# 项目进度与问题记录

本文档记录论文/系统实现过程中的重要阻塞问题、根因与修复，便于后续章节写作与复现。

---

## 2026-04-22：里程碑 — Autopsy 修改提案 + 网关自动 execute（P1–P5 闭环）

**仓库：** `Autopsy-Data-Extraction`（根 `README.md` mermaid 已含 `POST /api/upload` 与 `POST /api/modify/propose-with-token`）。

### 交付摘要

| 阶段 | 内容 |
|------|------|
| **P1** | `CaseRegistry.execute()` 放宽 proposer 校验（executor 可签）；`system-executor`；`executeAsExecutor`；`POST /api/modify/propose-with-token`；`GET /api/case-exists/:caseId`；相关单测与 `.env.example`。 |
| **P2** | `eventListener` 在 `ProposalApproved` 后 `executeAsExecutor`；`proposalAutoExecute.js`（`waitUntilProposalExecuted`、cursor 去重、`crudBacklog`）；`crudMirror.js` 重试/补偿复用。 |
| **P3** | Autopsy：`GatewayClient.proposeModification` / `caseExists`；`ProposalResponse`、`ProposalReceiptWriter`；设置面板 **Upload** 与 **Submit as modification proposal** 互斥 + Reason；`build-patch-core.bat` 纳入新源文件；`[4c/5]` 备份旧 patched JAR。 |
| **P4** | 真机：`install-patch-core.bat` 安装补丁；端到端 upload → propose → judge approve → 自动 execute；证据目录 `docs/evidence/autopsy-upload/proposal-flow/`。 |
| **P5** | 根 README、证据索引、`autopsy_upload_integration_plan` §10、`04fd5518` nbm todo→core-patch、章节映射更新。 |

### 运维注意（不入库文件）

以下路径由 `.gitignore` 排除，仅本地/部署环境存在：`api-gateway/.env`、`data/users.json`、`data/keystore/*.enc`、`data/audit.jsonl`、`data/audit-state.json`、`data/executor-cursor.json`、`patch/core.jar`、打出来的 `patch/org-sleuthkit-autopsy-core-patched.jar` 等。

### Cursor 计划（用户目录）

主计划文件名：**`autopsy-modify-reupload-flow_4086644d.plan.md`**（P1–P5 已全部 **completed**）。

---

## 2026-04：Judge Query「蓝条」与 `/api/query` 500

### 现象

1. **仅上链、无 proposal（Pending）** 或 **审批结束后**，Judge Web 的 **Query** 页有时出现蓝色提示：`t_case_hash`（CRUD）与 **CaseRegistry** 的 `record_hash` 不一致（`crudRegistryOutOfSync`）；同时第一条绿色结论仍可能显示「本地 record hash 与链上（Registry）一致」。
2. 加固 CRUD 读取逻辑后，部分环境出现 **`POST /api/query` 返回 500**，网关日志：`indexHash must be an even-length hex string (with or without 0x)`，栈指向 `chain.getMirroredRecordHash` → `normalizeChainHashHex`。

### 根因归纳

| 问题 | 说明 |
|------|------|
| **假阳性「蓝条」** | FISCO BCOS 2.x 下，对 CRUD 表按主键 `index_hash` 做 `Condition.eq` 再 `select` **不可靠**（代码注释已说明）。若直接采信返回的**第一行**，可能拿到**错误索引**对应的 `record_hash`，与 Registry 比较后误报不同步。 |
| **真不一致** | 上传或 execute 后 CRUD 镜像未与 Registry 对齐（失败重试、部分成功等）。设计上以 **CaseRegistry** 为权威，CRUD 为镜像；需 **`POST /api/modify/sync-crud-mirror`**（警察会话）或上传成功后的补偿写入。 |
| **500 错误** | `getMirroredRecordHash` 对链上返回的每一行使用**严格** `normalizeChainHashHex`。CRUD 偶发返回**非标准十六进制**（奇数长度、非法字符等）时**抛异常**，整条 Query 失败。 |

### 解决过程（实现要点）

1. **`chain.getMirroredRecordHash(indexHashRaw, recordHashCanonicalHint)`**  
   - 仅接受 `rows` 中 **`index_hash` 与当前 case 计算出的索引一致**的行。  
   - 否则不信任主键 `select` 结果，改为按 **value 列 `record_hash`** 查询（与既有注释一致：该路径更可靠），再在结果中核对 `index_hash`。  
   - 通过 **`module.exports`** 调用 `selectRecordByIndexHash` / `selectRecord`，保证单测 mock 生效。

2. **`tryNormalizeChainHashHex`**  
   - 对链上返回的 `index_hash` / `record_hash` 做宽松解析；无效则 **跳过该行**，不抛错，避免 **500**。

3. **`POST /api/upload`（合约模式）**  
   - 在 **CaseRegistry `createRecord` 成功后**，读取 Registry 与 CRUD；若不一致则 **`updateRecord`** 将 CRUD 对齐到 Registry（减少新上链 case 的镜像漂移）。

4. **测试**  
   - `api-gateway/test/query.test.js`：空链、Registry 优先、CRUD 滞后、主键误行、**畸形 hex 行**、503 等回归用例。

### 涉及文件（主要）

- `api-gateway/src/services/chain.js` — `getMirroredRecordHash`、`tryNormalizeChainHashHex`  
- `api-gateway/src/routes/query.js` — Query 使用 `getMirroredRecordHash`  
- `api-gateway/src/routes/upload.js` — 上传后 Registry/CRUD 对账  
- `api-gateway/test/query.test.js` — 回归测试  

### 运维提示

- **镜像补偿**：警察会话 `POST /api/modify/sync-crud-mirror`，body `{"caseId":"<id>"}`。  
- **语义**：Query 在配置 Registry 时以 **CaseRegistry** 为 record hash 权威；蓝条仅表示 **CRUD 镜像**与权威不一致，不等于「本地与合约业务数据定义不一致」（若第一条已为绿）。

---

## 2026-04：Judge Web S5.1（权威计划 Phase 5）

按 **`judge_web_dashboard_plan_1e12b7be.plan.md` §6**：**S5.1** 为 **Audit Trail** 基础渲染，而非 api-gateway 的 CaseRegistry 部署步骤。

- **`pages_ui/audit_trail_tab.py`**：`GET /api/audit?limit=50` → **`st.dataframe`**，列 **ts / event / proposalId / caller / txHash / blockNumber**（由 `args` 映射 `creator` / `proposer` / `approver`；无则 `—`）。
- **`requirements.txt`**：显式加入 **pandas**（供 DataFrame）。
- **`api-gateway/scripts/smoke.js`**：保留与 **`getMirroredRecordHash`** 及合约模式上传对账兼容的 mock（与 S5.1 无冲突）。

---

## 2026-04：Audit 中 `proposalId` / `caller` 为空

- **原因 1**：旧版 `serializeArgs` 依赖 `Object.keys(ev.args)` 且跳过数字键，与 ethers `Result` 不兼容。  
- **原因 2（根因）**：仓库使用的 **ethers v4 风格 `Interface.parseLog`** 返回 **`LogDescription`**：解码结果在 **`ev.values`**，参数表在 **`iface.events[ev.signature].inputs`**，**没有** `ev.args` / `ev.fragment`。仅按 `ev.args`+`ev.fragment` 序列化时恒为 **`{}`**。  
- **修复**：`serializeEventArgs(iface, ev)` 使用 **`ev.values`**（无则回退 `ev.args`）+ **`iface.events[ev.signature].inputs`**。重启网关后新写入的审计行会带齐字段。

---

## 2026-04：Audit `blockNumber` 与排序

- **现象**：`audit.jsonl` 顶行出现 ~10 万级 `blockNumber`，而当前链仅 ~800；时间却比下方行更旧。  
- **原因**：(1) 列表原按 `blockNumber` 排序，**换链/重置**后旧环境写入的高块号会压在最前；(2) 部分 SDK 路径下 `receipt.blockNumber` 为**十进制**，`parseInt(x, 16)` 会误解析。  
- **处理**：`parseReceiptBlockNumber` 统一解析；`readAuditLines` **优先按 `ts` 降序**；UI 提示可归档/清空审计文件。

---

*Last updated: 2026-04-22*
