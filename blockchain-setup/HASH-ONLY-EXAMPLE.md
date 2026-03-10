# Example: Full Write Flow for One Record

Using case `TEST-2025-001` to demonstrate the hash-only write flow.

---

## Prerequisites

- FISCO nodes running: `cd ~/fisco && bash nodes/127.0.0.1/start_all.sh`
- Console running: `cd ~/fisco/console && bash start.sh`

---

## Step 1: Create Table (first time only)

In **FISCO console**:

```
create table t_case_hash(index_hash varchar, record_hash varchar, primary key(index_hash))
```

---

## Step 2: Prepare Data and Compute Hashes

In **WSL terminal**:

```bash
cd /mnt/d/Dissertation/Data\ extraction/blockchain
mvn exec:java -Phash-only
```

Example output:

```
=== Hash-only chain storage demo ===

1. Stored in private store. Hashes:
   index_hash:  a1b2c3d4e5f6...   (64-char hex)
   record_hash: f6e5d4c3b2a1...   (64-char hex)

2. Run in FISCO console to insert on chain:
   insert into t_case_hash (index_hash, record_hash) values ("a1b2c3d4e5f6...", "f6e5d4c3b2a1...")
...
```

**Copy** the full `insert into t_case_hash ...` command (with real 64-char hashes).

---

## Step 3: Write Hashes to Chain

Back in **FISCO console**, paste and execute the insert command from step 2.

Or run directly (for `TEST-2025-001`, hashes from `mvn exec:java -Phash-only`):

```
insert into t_case_hash (index_hash, record_hash) values ("2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae", "22921f46a2311a643303665896f08685d26d7cbf218ae56ff2e4b4ea1d834ab0")
```

> Note: Run step 2 first so private store has the record; use hashes from step 2 output.

---

## Step 4: Verify

**In WeBASE**: Only `index_hash` and `record_hash` hex visible; no plaintext.

**In console**:

```
select * from t_case_hash where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

**Full record from private store**: `~/.case_record_store.json`, lookup by case_id.

---

## Full Command Summary (copy-paste)

**Terminal 1 - Start FISCO and Console:**
```bash
cd ~/fisco && bash nodes/127.0.0.1/start_all.sh
cd ~/fisco/console && bash start.sh
```

**Console - Step 1:**
```
create table t_case_hash(index_hash varchar, record_hash varchar, primary key(index_hash))
```

**Terminal 2 - Step 2:**
```bash
cd /mnt/d/Dissertation/Data\ extraction/blockchain
mvn exec:java -Phash-only
```

**Console - Step 3 (paste insert from step 2, or use above):**
```
insert into t_case_hash (index_hash, record_hash) values ("2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae", "22921f46a2311a643303665896f08685d26d7cbf218ae56ff2e4b4ea1d834ab0")
```

**Console - Step 4 query:**
```
select * from t_case_hash where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

---

## Custom Case Data

Edit `HashOnlyDemo.java` for `caseId`, `caseJson`, `aggregateHash`, `examiner`, `createdAt`, or call `HashOnlyWriteService` programmatically:

```java
HashOnlyWriteService write = new HashOnlyWriteService();
ChainInsertParams params = write.prepareAndStore(
    "CASE-2025-001",
    "{\"caseId\":\"CASE-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"...\",\"aggregateHashNote\":\"\"}",
    "computed_aggregateHash",
    "police",
    "2025-03-10 10:00:00"
);
System.out.println(write.getConsoleInsertCommand(params));
```
