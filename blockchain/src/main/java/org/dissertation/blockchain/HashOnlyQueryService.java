package org.dissertation.blockchain;

import java.io.IOException;

/**
 * Hash-only query: get full record from private store, verify against chain record_hash.
 */
public class HashOnlyQueryService {

    private final CaseRecordStore store;

    public HashOnlyQueryService() {
        this(new CaseRecordStore());
    }

    public HashOnlyQueryService(CaseRecordStore store) {
        this.store = store;
    }

    /**
     * Get full record from private store by case_id.
     *
     * @return Full record JSON, or null if not found
     */
    public String queryByCaseId(String caseId) throws IOException {
        return store.get(caseId);
    }

    /**
     * Compute index_hash for a case_id (use this to query chain: select by index_hash).
     */
    public String getIndexHashForQuery(String caseId) throws Exception {
        return HashOnlyRecord.computeIndexHash(caseId);
    }

    /**
     * Verify that full record's hash matches the chain's record_hash.
     *
     * @param fullRecordJson  From private store
     * @param chainRecordHash From chain (select record_hash where index_hash=...)
     * @return true if integrity verified
     */
    public boolean verifyIntegrity(String fullRecordJson, String chainRecordHash) throws Exception {
        return HashOnlyRecord.verifyRecordHash(fullRecordJson, chainRecordHash);
    }

    /**
     * Get console select command to fetch record_hash from chain.
     */
    public String getConsoleSelectCommand(String caseId) throws Exception {
        String indexHash = HashOnlyRecord.computeIndexHash(caseId);
        return String.format("select * from t_case_hash where index_hash = \"%s\"", indexHash);
    }
}
