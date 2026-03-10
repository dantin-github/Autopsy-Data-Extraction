# Hash-Only Chain Storage

Only hashes are stored on chain; full case records remain in private off-chain storage. WeBASE and chain queries see only hashes, not plaintext.

## Table Structure

```sql
create table t_case_hash(index_hash varchar, record_hash varchar, primary key(index_hash))
```

- `index_hash` = SHA256(case_id), used for lookup by case_id
- `record_hash` = SHA256(full record), used for integrity verification

## Write Flow

1. Use `HashOnlyWriteService.prepareAndStore()` to compute hashes and save to private store
2. Execute the returned insert command in console

```bash
# In blockchain directory
mvn exec:java -Phash-only
# Outputs insert command; copy to console and execute
```

Or Java call:

```java
HashOnlyWriteService write = new HashOnlyWriteService();
ChainInsertParams params = write.prepareAndStore(caseId, caseJson, aggregateHash, examiner, createdAt);
// Execute: insert into t_case_hash (index_hash, record_hash) values (params.indexHash, params.recordHash)
```

## Query Flow

1. Get full record from private store by case_id
2. Use `HashOnlyRecord.computeIndexHash(caseId)` to get index_hash
3. In console: `select * from t_case_hash where index_hash = "xxx"`
4. Compare returned record_hash with locally computed record_hash

## Private Store Path

Default: `~/.case_record_store.json`. Customise via `CaseRecordStore(Path)`.

## Full Example

See [HASH-ONLY-EXAMPLE.md](HASH-ONLY-EXAMPLE.md).

## Two-Party Modification

Modifications require police proposal + court approval. Only after both agree can the police execute. See [TWO-PARTY-MODIFICATION.md](TWO-PARTY-MODIFICATION.md).
