package org.dissertation.blockchain;

/**
 * Case data write service (police).
 * Writes full case data JSON to blockchain t_case_record table.
 * TODO: Implement with FISCO BCOS CRUDService when SDK CRUD module is available.
 */
public class CaseDataWriteService {

    public CaseDataWriteService(CaseDataBlockchainClient client) {
    }

    /**
     * Write case data to blockchain.
     *
     * @param caseDataJson Full case data JSON (must include caseId, aggregateHash)
     * @return Transaction reference for query/evidence
     */
    public String writeCaseData(String caseDataJson) throws Exception {
        throw new UnsupportedOperationException("Use console: insert t_case_record 'caseId' 'json' 'hash' 'examiner' 'timestamp'");
    }

    /**
     * Batch write (for historical data migration).
     */
    public java.util.List<String> writeCaseDataBatch(java.util.List<String> caseDataJsonList) throws Exception {
        throw new UnsupportedOperationException("Use console for batch insert");
    }
}
