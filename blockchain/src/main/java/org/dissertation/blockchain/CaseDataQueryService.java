package org.dissertation.blockchain;

/**
 * Case data query service (court).
 * Query by caseId and verify aggregateHash integrity.
 * TODO: Implement with FISCO BCOS CRUDService when SDK CRUD module is available.
 */
public class CaseDataQueryService {

    public CaseDataQueryService(CaseDataBlockchainClient client) {
    }

    /**
     * Query case data by case ID.
     *
     * @param caseId Case ID
     * @return Case data JSON string, or null if not found
     */
    public String queryByCaseId(String caseId) throws Exception {
        throw new UnsupportedOperationException("Use console: select t_case_record case_id 'caseId'");
    }

    /**
     * Query cases by examiner (simplified; CRUD queries by primary key only).
     */
    public java.util.List<String> queryByExaminer(String examiner) throws Exception {
        return new java.util.ArrayList<>();
    }

    /**
     * Verify aggregateHash: SHA-256 of JSON with aggregateHash/aggregateHashNote empty.
     *
     * @return true if data integrity verified
     */
    public boolean verifyIntegrity(String caseDataJson) throws Exception {
        throw new UnsupportedOperationException("Implement when queryByCaseId is available");
    }
}
