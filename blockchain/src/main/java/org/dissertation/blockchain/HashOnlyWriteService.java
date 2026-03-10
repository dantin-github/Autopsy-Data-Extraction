package org.dissertation.blockchain;

import java.io.IOException;

/**
 * Hash-only write: full record in private store, only hashes on chain.
 * Chain table: t_case_hash(index_hash, record_hash).
 */
public class HashOnlyWriteService {

    private final CaseRecordStore store;

    public HashOnlyWriteService() {
        this(new CaseRecordStore());
    }

    public HashOnlyWriteService(CaseRecordStore store) {
        this.store = store;
    }

    /**
     * Prepare for chain insert: save to private store, compute hashes.
     *
     * @return ChainInsertParams with index_hash and record_hash for console insert
     */
    public ChainInsertParams prepareAndStore(String caseId, String caseJson, String aggregateHash,
                                             String examiner, String createdAt) throws Exception {
        String recordHash = HashOnlyRecord.computeRecordHash(caseId, caseJson, aggregateHash, examiner, createdAt);
        String indexHash = HashOnlyRecord.computeIndexHash(caseId);

        store.save(caseId, caseJson, aggregateHash, examiner, createdAt);

        return new ChainInsertParams(indexHash, recordHash);
    }

    /**
     * Get console insert command for t_case_hash table.
     */
    public String getConsoleInsertCommand(ChainInsertParams params) {
        return String.format(
            "insert into t_case_hash (index_hash, record_hash) values (\"%s\", \"%s\")",
            params.indexHash, params.recordHash
        );
    }

    public static class ChainInsertParams {
        public final String indexHash;
        public final String recordHash;

        public ChainInsertParams(String indexHash, String recordHash) {
            this.indexHash = indexHash;
            this.recordHash = recordHash;
        }
    }
}
