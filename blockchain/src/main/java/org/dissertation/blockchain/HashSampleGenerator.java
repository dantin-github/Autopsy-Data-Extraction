package org.dissertation.blockchain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

/**
 * Prints 20 deterministic lines of JSON to stdout (JSONL), one row per sample.
 * Each line has fields needed for Node {@code hashOnly} cross-check tests.
 *
 * <p>Run: {@code mvn -q -P hash-samples exec:java}
 */
public final class HashSampleGenerator {

    private HashSampleGenerator() {}

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 20; i++) {
            String caseId = buildCaseId(i);
            String caseJson = buildCaseJson(i);
            String aggregateHash = buildAggregateHash(i);
            String examiner = buildExaminer(i);
            String createdAt = buildCreatedAt(i);

            String expectedIndexHash = HashOnlyRecord.computeIndexHash(caseId);
            String expectedRecordHash =
                    HashOnlyRecord.computeRecordHash(caseId, caseJson, aggregateHash, examiner, createdAt);

            JSONObject line = new JSONObject(true);
            line.put("caseId", caseId);
            line.put("caseJson", caseJson);
            line.put("aggregateHash", aggregateHash);
            line.put("examiner", examiner);
            line.put("createdAt", createdAt);
            line.put("expectedIndexHash", expectedIndexHash);
            line.put("expectedRecordHash", expectedRecordHash);
            System.out.println(JSON.toJSONString(line));
        }
    }

    private static String buildCaseId(int i) {
        if (i == 0) {
            return "MIN";
        }
        if (i == 1) {
            return "CASE-2025-COURT-REF";
        }
        if (i == 2) {
            return "";
        }
        return "SAMPLE-" + String.format("%02d", i) + "-" + (char) ('A' + (i % 26));
    }

    private static String buildCaseJson(int i) {
        JSONObject o = new JSONObject(true);
        o.put("seq", i);
        o.put("label", "row-" + i);
        if (i % 3 == 0) {
            o.put("nested", nested(i));
        }
        if (i % 4 == 1) {
            o.put("empty", "");
        }
        if (i == 7) {
            o.put("note", "ascii-only-to-avoid-windows-pipe-encoding");
        }
        return o.toJSONString();
    }

    private static JSONObject nested(int i) {
        JSONObject n = new JSONObject(true);
        n.put("k", "v" + i);
        n.put("n", i * 7);
        return n;
    }

    private static String buildAggregateHash(int i) throws Exception {
        if (i == 3) {
            return "";
        }
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(("agg-seed-" + i).getBytes(StandardCharsets.UTF_8));
        byte[] d = md.digest();
        StringBuilder sb = new StringBuilder(64);
        for (byte b : d) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static String buildExaminer(int i) {
        if (i == 5) {
            return "";
        }
        return "examiner-" + i % 4;
    }

    private static String buildCreatedAt(int i) {
        int day = (i % 28) + 1;
        int month = (i % 12) + 1;
        return String.format("2025-%02d-%02d %02d:%02d:00", month, day, i % 24, i % 60);
    }
}
