# Autopsy Case Data Extract Plugin

A plugin for Autopsy 4.22.x that extracts forensic audit data from a case and
exports it as a structured JSON report. It also provides a live status window
that monitors plugin activity and verifies image-file integrity on every case open.

---

## Features

- **Case metadata** — Case ID, examiner name, case open/close timestamps
- **Operation log** — Automatically records every significant case event
  (data source added, report generated, case details changed, etc.) with
  timestamps and the active examiner; persisted to `case_extract_events.json`
  in the case directory
- **Data source hashes** — Path, MD5, and SHA-256 for every image/logical
  data source as stored by Autopsy
- **Full file listing** — Name, path, size, timestamps, allocation status,
  known status, MIME type, MD5, and SHA-256 for **every** file inside the
  image (allocated, unallocated, deleted, carved)
- **Aggregate SHA-256** — A single hash covering all of the above, for
  end-to-end integrity verification of the exported report
- **Image integrity check** — On every case open the plugin rehashes the
  physical image file(s) in a background thread and compares the result
  against the last exported report; the status window highlights any mismatch
  as a potential tampering warning

---

## Requirements

| Component | Version |
|-----------|---------|
| Java | 17 |
| Autopsy | 4.22.1 (other 4.x may work) |
| OS | Windows 10 / 11 (build scripts are `.bat`) |

---

## Build

The plugin is embedded directly into Autopsy's core module JAR via a patch
script (standard NetBeans NBM installation is blocked by Autopsy's custom
module loader).

```powershell
# From the project root — no additional tools required
build-patch-core.bat
```

What the script does:
1. Compiles all Java sources against Autopsy's bundled JDK and classpath
2. Extracts the original `org-sleuthkit-autopsy-core.jar`
3. Injects the plugin classes and service/layer registrations
4. Repackages the JAR, preserving the original `MANIFEST.MF`

Output: `patch\org-sleuthkit-autopsy-core-patched.jar`

> **Note** — `patch\core.jar` (the original Autopsy core JAR) is excluded
> from version control. Copy it from your Autopsy installation:
> `C:\Program Files\Autopsy-4.22.1\autopsy\modules\org-sleuthkit-autopsy-core.jar`

---

## Usage

### Status window

Open via **Window → Case Data Extract Status** or the toolbar button (same
row as Keyword Search).

**Operations Log tab** — live table of every recorded case event with
timestamp, action type, examiner, and detail.

**Image Integrity tab** — one row per image data source showing:

| Column | Description |
|--------|-------------|
| Image | Data source name |
| File Path | Physical path on disk |
| Status | `Checking… X%` → `OK — integrity verified` or `TAMPERED — hash mismatch!` |
| File SHA-256 (computed) | Fresh hash of the physical file bytes |
| Reference SHA-256 (report) | SHA-256 from the last exported report (or DB hash if no report exists yet) |

The hash computation runs in a background thread; the table updates
automatically every 2 seconds until complete.

### Generating a report

1. Open a case in Autopsy and complete any desired analysis
2. **Tools → Generate Report**
3. Select **Case Data Extract Report**
4. Choose an output directory and click **Generate**

The report is written to:
```
<case dir>/Reports/<run label>/CaseDataExtract/case_data_extract.json
```

**Report structure:**
```json
{
  "caseId":        "...",
  "examiner":      "...",
  "generatedAt":   "2026-03-06 00:01:34",
  "dataSources": [ { "name": "...", "paths": [...], "md5": "...", "sha256": "..." } ],
  "operations":  [ { "time": "...", "type": "CASE_OPENED", "operator": "...", "detail": "..." } ],
  "files":       [ { "name": "...", "path": "...", "size": 0, "md5": "...", "sha256": "..." } ],
  "aggregateHash": "...",
  "aggregateHashNote": "SHA-256 of the report body with aggregateHash field zeroed"
}
```

The `aggregateHash` is the SHA-256 of the entire report body (UTF-8) with
the `aggregateHash` and `aggregateHashNote` fields set to empty strings, so
any change to any part of the report invalidates it.

---

## Project structure

```
src/
  org/sleuthkit/autopsy/report/caseextract/
    CaseEventRecorder.java                  # Case event listener, operation log,
    │                                       # image integrity check engine
    CaseDataExtractMonitorTopComponent.java # Status window (TopComponent)
    OpenCaseDataExtractMonitorAction.java   # Toolbar / menu action to open the window
    CaseDataExtractReportModule.java        # GeneralReportModule — JSON report export
    Bundle.properties                       # UI strings
  META-INF/
    MANIFEST.MF
    services/org.sleuthkit.autopsy.report.GeneralReportModule
  org/.../caseextract/resources/
    layer.xml                               # NetBeans layer — menu/toolbar registration

install-config/
  core-layer-patched.xml                   # Patched Autopsy core layer.xml
  core-GeneralReportModule-services.txt    # Service registration injected into core JAR

patch/                                     # Build working directory (gitignored except scripts)
build-patch-core.bat                       # Main build script
INSTALL-AS-ADMIN.bat                       # Installation script (requires Administrator)
clear-cache-and-restart.bat                # Utility: clear NetBeans cache
```

---

## Viewing Autopsy logs (troubleshooting)

1. **Menu**: Autopsy → **Help → Open Log Folder**
2. **Manual path**: `%APPDATA%\autopsy\var\log`
3. Key files:
   - `autopsy.log.0` — main application log
   - `messages.log` — detailed startup and module loading info
4. Search for `caseextract`, `SEVERE`, or `Exception` to locate plugin-related errors

---

## Notes on image format compatibility

| Format | File hash vs. DB hash | Integrity check |
|--------|-----------------------|-----------------|
| Raw (`dd` / `img`) | Identical — both cover the same bytes | Fully supported |
| EnCase (`E01`) | Different — DB hash is the logical disk content; file hash is the E01 container | Use **report** as reference (generate once, verify on subsequent opens) |

For best results with any format: generate a report immediately after adding
a data source, then use the Image Integrity tab on all subsequent case opens.

---

## Blockchain Module (Case Data Integrity)

The project includes a **blockchain module** for storing case data hashes on a FISCO BCOS chain, providing tamper-evident integrity verification.

### Overview

| Component | Description |
|-----------|-------------|
| `blockchain/` | Java SDK module — hash computation, private store, chain write/query |
| `blockchain-setup/` | Setup scripts — WSL, FISCO BCOS 4-node chain, WeBASE |

### Hash-Only Storage

Only hashes are stored on chain; full case records remain in private off-chain storage (`~/.case_record_store.json`). WeBASE and chain queries see only hashes, not plaintext.

- **index_hash** = SHA256(case_id) — primary key for lookup
- **record_hash** = SHA256(full record) — integrity verification

### Two-Party Modification

Modifications require **police proposal + court approval**. Only after both agree can the police execute the update. See `blockchain-setup/TWO-PARTY-MODIFICATION.md`.

### Quick Start

1. **Setup chain** (WSL): `bash blockchain-setup/2-setup-fisco.sh`
2. **Create table** in console: `create table t_case_hash(index_hash varchar, record_hash varchar, primary key(index_hash))`
3. **Generate insert** from Java: `cd blockchain && mvn exec:java -Phash-only`
4. **Optional WeBASE**: `bash blockchain-setup/3-setup-webase.sh` → http://localhost:5000

See `blockchain/README.md` and `blockchain-setup/README.md` for details.

---

## Central API Gateway (Node) & Phase 2 contract

The repository includes **`api-gateway/`** — an HTTP gateway that:

- uploads case hashes (`POST /api/upload`) and writes to FISCO CRUD + optional **`CaseRegistry`** (`CHAIN_MODE=contract`);
- runs the **two-party** flow (`/api/modify/*`) against **`CaseRegistry.sol`**;
- appends contract events to **`data/audit.jsonl`** and exposes **`GET /api/audit`** (judge session).

**Full setup (clean machine):** follow **`api-gateway/README.md`** end-to-end: Node 18+, `npm install`, `.env` from **`.env.example`**, `npm run compile`, `npm run deploy-contract`, `npm run seed-users`, `npm run seed-roles`, `npm run dev`.

**Dissertation evidence (Phase 9):** **`docs/evidence/`** — ABI copy, CSVs of negative tx hashes, HTTP samples, **chapter → evidence** mapping (`chapter-evidence-mapping.md`), WeBASE screenshot checklist (`docs/evidence/webase/README.md`). Regenerate the ABI copy after contract changes (see `docs/evidence/README.md`).

---

## License

This plugin is provided for research and academic use. It is independent of
and not affiliated with the Autopsy or Sleuth Kit projects. Refer to the
[Autopsy](https://www.sleuthkit.org/autopsy/) and
[Sleuth Kit](https://www.sleuthkit.org/) license terms before redistribution.
