package org.dissertation.blockchain;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Standalone integrity verifier. No chain connection needed.
 * Verifies that aggregateHash matches SHA-256 of JSON with hash fields empty.
 */
public class IntegrityVerifier {

    public static boolean verify(String caseDataJson) throws Exception {
        JSONObject json = JSON.parseObject(caseDataJson);
        String storedHash = json.getString("aggregateHash");
        if (storedHash == null || storedHash.isEmpty()) {
            return false;
        }
        json.put("aggregateHash", "");
        json.put("aggregateHashNote", "");
        String forHash = json.toJSONString();
        String computed = sha256Hex(forHash.getBytes(StandardCharsets.UTF_8));
        return computed.equalsIgnoreCase(storedHash);
    }

    public static String computeHash(String caseDataJson) throws Exception {
        JSONObject json = JSON.parseObject(caseDataJson);
        json.put("aggregateHash", "");
        json.put("aggregateHashNote", "");
        return sha256Hex(json.toJSONString().getBytes(StandardCharsets.UTF_8));
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

    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("Usage: pass case_json as arg, or 'test' for demo");
            System.out.println("  mvn exec:java -Dexec.mainClass=org.dissertation.blockchain.IntegrityVerifier -Dexec.args='{\"caseId\":\"X\",\"aggregateHash\":\"abc\"}'");
            return;
        }
        try {
            String json = args[0];
            if ("test".equals(json)) {
                String testJson = "{\"caseId\":\"TEST-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"\",\"aggregateHashNote\":\"\"}";
                String hash = computeHash(testJson);
                JSONObject o = JSON.parseObject(testJson);
                o.put("aggregateHash", hash);
                o.put("aggregateHashNote", "SHA-256 of body");
                testJson = o.toJSONString();
                System.out.println("Test JSON: " + testJson);
                System.out.println("Computed hash: " + hash);
                System.out.println("Verify: " + verify(testJson));
                return;
            }
            boolean ok = verify(json);
            System.out.println("Integrity verified: " + ok);
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
        }
    }
}
