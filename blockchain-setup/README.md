# FISCO BCOS Case Data Blockchain Setup

## Prerequisites

- Windows 10/11 (build 1903+)
- 8GB+ RAM, 50GB+ free disk
- Administrator rights (for WSL install)

## Step 1: Install WSL

1. Open PowerShell **as Administrator**
2. Run:
   ```powershell
   .\1-install-wsl.ps1
   ```
3. **Restart PC**
4. After restart, open Microsoft Store, install **Ubuntu 20.04 LTS**
5. Launch Ubuntu, set username and password

## Step 2: Build FISCO BCOS Chain

In **WSL (Ubuntu)** terminal:

```bash
cd /mnt/d/Dissertation/Data\ extraction/blockchain-setup
bash 2-setup-fisco.sh
```

Or from PowerShell:

```powershell
wsl bash "d:/Dissertation/Data extraction/blockchain-setup/2-setup-fisco.sh"
```

Script will: install openssl/curl/JDK, download chain, start nodes, download console.

## Step 3: Create Table and Verify

Start console:

```bash
cd ~/fisco/console
bash start.sh
```

**Hash-only mode (recommended, no plaintext on chain):**

```bash
# Create hash table
create table t_case_hash(index_hash varchar, record_hash varchar, primary key(index_hash))

# Run blockchain module to generate insert command
# mvn exec:java -Phash-only outputs the insert command
```

See [HASH-ONLY-CHAIN.md](HASH-ONLY-CHAIN.md).

**Plaintext mode (legacy):**

```bash
create table t_case_record(case_id varchar, case_json varchar, aggregate_hash varchar, examiner varchar, created_at varchar, primary key(case_id))
insert into t_case_record (case_id, case_json, aggregate_hash, examiner, created_at) values ("TEST-2025-001", "{\"caseId\":\"TEST-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"abc123\"}", "abc123", "police", "2025-03-10 10:00:00")
select * from t_case_record where case_id = "TEST-2025-001"
```

## Step 4: Deploy WeBASE (Optional)

For web-based blockchain management:

```bash
cd /mnt/d/Dissertation/Data\ extraction/blockchain-setup
bash 3-setup-webase.sh
```

Then open http://localhost:5000 (login: admin / Abcd1234). If nodes show 0 or you see "user not logged in" when using the API, add the front via the Web UI (Chain Management → add node) or see [WEBASE-WEB-AUTH.md](WEBASE-WEB-AUTH.md).

## Commands

| Action | Command |
|--------|---------|
| Start nodes | `cd ~/fisco && bash nodes/127.0.0.1/start_all.sh` |
| Stop nodes | `cd ~/fisco && bash nodes/127.0.0.1/stop_all.sh` |
| Start console | `cd ~/fisco/console && bash start.sh` |
| Start WeBASE | `cd ~/webase-deploy && python3 deploy.py startAll` |
| Stop WeBASE | `cd ~/webase-deploy && python3 deploy.py stopAll` |

## SDK Certs

Copy from `~/fisco/nodes/127.0.0.1/sdk/` to `blockchain/conf/`:

```bash
mkdir -p /mnt/d/Dissertation/Data\ extraction/blockchain/conf
cp ~/fisco/nodes/127.0.0.1/sdk/* /mnt/d/Dissertation/Data\ extraction/blockchain/conf/
```

## Next

After chain is verified:
1. Use `blockchain` module Java API for write/query
2. WeBASE at http://localhost:5000 for visualization
