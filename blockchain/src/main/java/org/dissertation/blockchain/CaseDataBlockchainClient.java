package org.dissertation.blockchain;

import org.fisco.bcos.sdk.BcosSDK;
import org.fisco.bcos.sdk.client.Client;
import org.fisco.bcos.sdk.config.ConfigOption;
import org.fisco.bcos.sdk.config.model.ConfigProperty;
import org.fisco.bcos.sdk.crypto.keypair.CryptoKeyPair;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;

/**
 * FISCO BCOS chain client.
 * Initializes from config.toml or defaults for CaseDataWriteService and CaseDataQueryService.
 */
public class CaseDataBlockchainClient {

    private static final String DEFAULT_GROUP_ID = "1";
    private static final String DEFAULT_PEER = "127.0.0.1:20200";

    private final BcosSDK sdk;
    private final Client client;
    private final CryptoKeyPair credential;

    public CaseDataBlockchainClient(String configPath) throws Exception {
        Path path = Paths.get(configPath);
        if (path.toFile().exists()) {
            sdk = BcosSDK.build(path.toString());
        } else {
            ConfigProperty property = new ConfigProperty();
            property.setCryptoMaterial(Collections.singletonMap("certPath", "conf"));
            property.setNetwork(Collections.singletonMap("peers", Collections.singletonList(DEFAULT_PEER)));
            sdk = new BcosSDK(new ConfigOption(property));
        }
        client = sdk.getClient(Integer.parseInt(DEFAULT_GROUP_ID));
        credential = client.getCryptoSuite().getCryptoKeyPair();
    }

    public Client getClient() {
        return client;
    }

    public CryptoKeyPair getCredential() {
        return credential;
    }

    public void shutdown() {
        if (sdk != null) {
            sdk.stopAll();
        }
    }
}
