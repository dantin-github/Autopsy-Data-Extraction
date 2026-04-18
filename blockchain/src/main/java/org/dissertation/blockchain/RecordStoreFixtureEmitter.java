package org.dissertation.blockchain;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Writes one record via {@link CaseRecordStore} for Node interop tests.
 *
 * <p>Set env {@code RECORD_STORE_FIXTURE_PATH} to the absolute path of the JSON file to write, then:
 * {@code mvn -q -P record-store-fixture exec:java}
 */
public final class RecordStoreFixtureEmitter {

    private RecordStoreFixtureEmitter() {}

    public static void main(String[] args) throws Exception {
        String envPath = System.getenv("RECORD_STORE_FIXTURE_PATH");
        if (envPath == null || envPath.isEmpty()) {
            System.err.println("Set RECORD_STORE_FIXTURE_PATH to an absolute path for the store file.");
            System.exit(1);
        }
        Path p = Paths.get(envPath);
        String caseJson =
                "{\"caseId\":\"TEST-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"abc123\",\"aggregateHashNote\":\"\"}";
        CaseRecordStore store = new CaseRecordStore(p);
        store.save("TEST-2025-001", caseJson, "abc123", "police", "2025-03-10 10:00:00");
    }
}
