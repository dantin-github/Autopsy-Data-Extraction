package org.dissertation.blockchain;

/**
 * Demo: hash-only chain storage.
 * Run: mvn exec:java -Phash-only
 */
public class HashOnlyDemo {

    public static void main(String[] args) throws Exception {
        HashOnlyWriteService write = new HashOnlyWriteService();
        HashOnlyQueryService query = new HashOnlyQueryService();

        String caseId = "TEST-2025-001";
        String caseJson = "{\"caseId\":\"TEST-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"abc123\",\"aggregateHashNote\":\"\"}";
        String aggregateHash = "abc123";
        String examiner = "police";
        String createdAt = "2025-03-10 10:00:00";

        System.out.println("=== Hash-only chain storage demo ===\n");

        // 1. Prepare and store
        HashOnlyWriteService.ChainInsertParams params = write.prepareAndStore(
            caseId, caseJson, aggregateHash, examiner, createdAt);
        System.out.println("1. Stored in private store. Hashes:");
        System.out.println("   index_hash:  " + params.indexHash);
        System.out.println("   record_hash: " + params.recordHash);

        // 2. Console command for chain insert
        System.out.println("\n2. Run in FISCO console to insert on chain:");
        System.out.println("   " + write.getConsoleInsertCommand(params));

        // 3. Query from private store
        String fullRecord = query.queryByCaseId(caseId);
        System.out.println("\n3. Query from private store:");
        System.out.println("   " + (fullRecord != null ? fullRecord : "(not found)"));

        // 4. Verify (simulate chain returned record_hash)
        boolean ok = query.verifyIntegrity(fullRecord, params.recordHash);
        System.out.println("\n4. Integrity verify: " + ok);

        System.out.println("\n5. To query from chain (console):");
        System.out.println("   " + query.getConsoleSelectCommand(caseId));
        System.out.println("\nChain stores only hashes - no plaintext case data.");
    }
}
