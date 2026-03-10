package org.dissertation.blockchain;

/**
 * Verification: connect to chain and get block number.
 * Run main() after chain and console are ready.
 * Full CRUD write/query: use console or CaseDataWriteService/CaseDataQueryService.
 */
public class BlockchainVerificationTest {

    public static void main(String[] args) {
        String configPath = args.length > 0 ? args[0] : "conf/config.toml";
        try {
            CaseDataBlockchainClient client = new CaseDataBlockchainClient(configPath);
            org.fisco.bcos.sdk.client.protocol.response.BlockNumber bn = client.getClient().getBlockNumber();
            System.out.println("[OK] Connected to chain. Block number: " + bn.getBlockNumber());
            client.shutdown();
            System.out.println("Verification complete.");
        } catch (Exception e) {
            System.err.println("Verification failed: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
