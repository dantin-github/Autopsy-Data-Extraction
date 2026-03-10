# Verify Data Immutability

## Method 1: Hash Integrity Check (Recommended)

**Step 1:** Run demo first:
```bash
cd /mnt/d/Dissertation/Data\ extraction/blockchain
mvn exec:java -Pintegrity
```
This shows the hash computation and verification flow (Test JSON, Computed hash, Verify: true).

**Step 2:** Insert a record with proper JSON (if you used "test-json" before, insert this):
```
insert into t_case_record (case_id, case_json, aggregate_hash, examiner, created_at) values ("IMMUT-001", "{\"caseId\":\"IMMUT-001\",\"examiner\":\"police\",\"aggregateHash\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"aggregateHashNote\":\"\"}", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "police", "2025-03-10")
```
(aggregateHash above is SHA-256 of empty string; for real data, compute first.)

**Step 3:** Query data from console:
```
select * from t_case_record where case_id = "IMMUT-001"
```
Copy the `case_json` value from the result.

**Step 4:** Verify integrity (use case_json from step 3). Example for IMMUT-001:
```bash
mvn exec:java -Pintegrity-verify -Dintegrity.json='{"caseId":"IMMUT-001","examiner":"police","aggregateHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","aggregateHashNote":""}'
```

**Step 5:** If output is `Integrity verified: true`, the data matches its aggregateHash.

**Step 6 (Tampering demo):** Change one character in the JSON, run again. Output will be `Integrity verified: false`.

---

## Method 2: Console-Only Check

1. Query: `select * from t_case_record where case_id = "TEST-2025-001"`
2. Note the `aggregate_hash` and `case_json`.
3. The chain stores both. If someone tampered with case_json, the hash would not match a recomputed SHA-256. You cannot modify chain data in place — blockchain is append-only.

---

## Method 3: Consensus-Level (Advanced)

If you directly modify the LevelDB/RocksDB files in `~/fisco/nodes/127.0.0.1/node0/data/`, that node will fail PBFT consensus (hash mismatch with other nodes) and be isolated. The chain continues with the other 3 nodes; the tampered node cannot participate. **Warning:** This corrupts the node; backup first.
