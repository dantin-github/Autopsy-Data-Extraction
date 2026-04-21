# 项目进度与问题记录

本文档记录论文/系统实现过程中的重要阻塞问题、根因与修复，便于后续章节写作与复现。

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

---

## 2026-04：Judge Web · S5.1（CaseRegistry 部署可见性）

计划文件中的 **S5.1** 与 `api-gateway/README.md` **Phase 5 · Deploy CaseRegistry (S5.1)** 对齐（`npm run deploy-contract`）。在 Judge Dashboard 侧补充：

- **`GET /health`** 增加 **`gateway`** 对象：链模式、FISCO CRUD 是否就绪、`CASE_REGISTRY_ADDR` 是否已配置（仅返回地址 **末 6 位 hex** 便于对账，不暴露完整地址）、上传是否走合约路径。
- **Streamlit 侧边栏**「**CaseRegistry (S5.1)**」：静态说明 + 在 **Ping Gateway** 成功后展示上述字段。

涉及：`api-gateway/src/app.js`、`api-gateway/test/health.test.js`、`judge-web/app.py`。

---

*Last updated: 2026-04-20*
