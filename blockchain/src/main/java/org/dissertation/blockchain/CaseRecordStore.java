package org.dissertation.blockchain;

import com.alibaba.fastjson.JSON;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

/**
 * Private off-chain storage for full case records.
 * Chain stores only hashes; full data stays here.
 */
public class CaseRecordStore {

    private final Path storePath;

    public CaseRecordStore() {
        this(Paths.get(System.getProperty("user.home"), ".case_record_store.json"));
    }

    public CaseRecordStore(Path storePath) {
        this.storePath = storePath;
    }

    /**
     * Save full record. Key = case_id.
     */
    public void save(String caseId, String caseJson, String aggregateHash, String examiner, String createdAt) throws IOException {
        Map<String, String> record = new HashMap<>();
        record.put("case_id", caseId);
        record.put("case_json", caseJson != null ? caseJson : "");
        record.put("aggregate_hash", aggregateHash != null ? aggregateHash : "");
        record.put("examiner", examiner != null ? examiner : "");
        record.put("created_at", createdAt != null ? createdAt : "");
        save(caseId, JSON.toJSONString(record));
    }

    /**
     * Save full record JSON string.
     */
    public void save(String caseId, String fullRecordJson) throws IOException {
        Map<String, String> store = loadStore();
        store.put(caseId, fullRecordJson);
        writeStore(store);
    }

    /**
     * Get full record by case_id.
     */
    public String get(String caseId) throws IOException {
        Map<String, String> store = loadStore();
        Object v = store.get(caseId);
        return v != null ? v.toString() : null;
    }

    /**
     * Check if case_id exists.
     */
    public boolean exists(String caseId) throws IOException {
        return get(caseId) != null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> loadStore() throws IOException {
        if (!Files.exists(storePath)) {
            return new HashMap<>();
        }
        String content = new String(Files.readAllBytes(storePath), StandardCharsets.UTF_8);
        if (content.trim().isEmpty()) {
            return new HashMap<>();
        }
        return new HashMap<>(JSON.parseObject(content, Map.class));
    }

    private void writeStore(Map<String, String> store) throws IOException {
        Path parent = storePath.getParent();
        if (parent != null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }
        Files.write(storePath, JSON.toJSONString(store).getBytes(StandardCharsets.UTF_8));
    }
}
