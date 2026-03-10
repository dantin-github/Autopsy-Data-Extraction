package org.dissertation.blockchain;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Hash-only chain storage: all case data (including ID) is hashed before going on chain.
 * Chain stores only index_hash (for lookup) and record_hash (for integrity).
 * Full records kept in private off-chain storage.
 */
public final class HashOnlyRecord {

    private HashOnlyRecord() {}

    /**
     * Compute index_hash = SHA256(case_id). Used as primary key for chain lookup.
     */
    public static String computeIndexHash(String caseId) throws Exception {
        return sha256Hex(caseId.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Compute record_hash = SHA256(canonical full record).
     * Full record = JSON with: case_id, case_json, aggregate_hash, examiner, created_at.
     * Keys sorted for deterministic serialization.
     */
    public static String computeRecordHash(String caseId, String caseJson, String aggregateHash,
                                           String examiner, String createdAt) throws Exception {
        JSONObject o = new JSONObject(true); // ordered
        o.put("case_id", caseId);
        o.put("case_json", caseJson != null ? caseJson : "");
        o.put("aggregate_hash", aggregateHash != null ? aggregateHash : "");
        o.put("examiner", examiner != null ? examiner : "");
        o.put("created_at", createdAt != null ? createdAt : "");
        return sha256Hex(o.toJSONString().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Compute record_hash from a full record JSON (from private store).
     * Expects keys: case_id, case_json, aggregate_hash, examiner, created_at.
     */
    public static String computeRecordHashFromJson(String fullRecordJson) throws Exception {
        JSONObject o = JSON.parseObject(fullRecordJson);
        return computeRecordHash(
            o.getString("case_id"),
            o.getString("case_json"),
            o.getString("aggregate_hash"),
            o.getString("examiner"),
            o.getString("created_at")
        );
    }

    /**
     * Verify that a full record's hash matches the chain's record_hash.
     */
    public static boolean verifyRecordHash(String fullRecordJson, String chainRecordHash) throws Exception {
        String computed = computeRecordHashFromJson(fullRecordJson);
        return computed != null && computed.equalsIgnoreCase(chainRecordHash);
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(data);
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }
}
