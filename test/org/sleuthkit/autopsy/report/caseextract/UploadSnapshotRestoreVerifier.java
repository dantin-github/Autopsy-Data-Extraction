package org.sleuthkit.autopsy.report.caseextract;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;
import org.sleuthkit.autopsy.report.caseextract.gateway.SimpleJson;

/**
 * Offline check: same path Autopsy uses after restart — {@link UploadSnapshot#loadLatestFromCaseReports(String)} must
 * match the newest {@code upload_receipt.json} on disk. Run: {@code ant verify-upload-restore -Dcase.dir="D:\path\to\case"}.
 */
public final class UploadSnapshotRestoreVerifier {

    private UploadSnapshotRestoreVerifier() {
    }

    public static void main(String[] args) throws Exception {
        String caseDir = System.getProperty("case.dir");
        if (caseDir == null || caseDir.isBlank()) {
            caseDir = args.length > 0 ? args[0] : "";
        }
        if (caseDir.isBlank()) {
            System.err.println("Usage: java ... UploadSnapshotRestoreVerifier <caseDirectory>");
            System.err.println("   or: -Dcase.dir=... ");
            System.exit(2);
        }
        File root = new File(caseDir);
        if (!root.isDirectory()) {
            throw new AssertionError("Not a directory: " + caseDir);
        }
        File receipt = findLatestReceipt(root);
        if (receipt == null) {
            throw new AssertionError("No upload_receipt.json under Reports/*/CaseDataExtract in " + caseDir);
        }
        Map<String, Object> expected =
                SimpleJson.parseObject(Files.readString(receipt.toPath(), StandardCharsets.UTF_8));
        UploadSnapshot s = UploadSnapshot.loadLatestFromCaseReports(root.getAbsolutePath());
        if (s == null) {
            throw new AssertionError("loadLatestFromCaseReports returned null");
        }
        eq("uploadStatus", str(expected, "uploadStatus"), s.getStatus());
        eq("clientRoundTripMs", longVal(expected.get("clientRoundTripMs")), s.getClientRoundTripMs());
        eq("errorKind", str(expected, "errorKind"), s.getErrorKind());
        eq("httpStatus", (int) longVal(expected.get("httpStatus")), s.getHttpStatus());
        if (!str(expected, "requestId").isEmpty()) {
            eq("requestId", str(expected, "requestId"), s.getRequestId());
        }
        if (!str(expected, "txHash").isEmpty()) {
            eq("txHash", str(expected, "txHash"), s.getTxHash());
        }
        if (expected.get("timing") instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> t = (Map<String, Object>) expected.get("timing");
            UploadSnapshot.Timing st = s.getTiming();
            eq("timing.totalMs", longVal(t.get("totalMs")), st.getTotalMs());
            eq("timing.integrityMs", longVal(t.get("integrityMs")), st.getIntegrityMs());
            eq("timing.chainMs", longVal(t.get("chainMs")), st.getChainMs());
        }
        String wantCaseId = str(expected, "caseId");
        if (wantCaseId.isEmpty()) {
            File caseJson = new File(receipt.getParentFile(), UploadSnapshot.CASE_DATA_EXTRACT_REPORT_JSON);
            if (caseJson.isFile()) {
                String json = Files.readString(caseJson.toPath(), StandardCharsets.UTF_8);
                wantCaseId = extractCaseIdQuick(json);
            }
        }
        if (!wantCaseId.isEmpty() && !wantCaseId.equals(s.getCaseId())) {
            throw new AssertionError("caseId: expected \"" + wantCaseId + "\" got \"" + s.getCaseId() + "\"");
        }
        System.out.println("OK restore matches " + receipt.getAbsolutePath());
        System.out.println("   status=" + s.getStatus() + " caseId=" + s.getCaseId() + " rttMs=" + s.getClientRoundTripMs());
    }

    /** Same idea as {@link UploadSnapshot} sibling report scan. */
    private static String extractCaseIdQuick(String json) {
        String key = "\"caseId\"";
        int k = json.indexOf(key);
        if (k < 0) {
            return "";
        }
        int colon = json.indexOf(':', k + key.length());
        if (colon < 0) {
            return "";
        }
        int i = colon + 1;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) {
            i++;
        }
        if (i >= json.length() || json.charAt(i) != '"') {
            return "";
        }
        i++;
        StringBuilder sb = new StringBuilder();
        while (i < json.length()) {
            char c = json.charAt(i++);
            if (c == '"') {
                break;
            }
            if (c == '\\' && i < json.length()) {
                sb.append(json.charAt(i++));
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static File findLatestReceipt(File caseRoot) {
        File reports = new File(caseRoot, "Reports");
        if (!reports.isDirectory()) {
            return null;
        }
        File[] subs = reports.listFiles(File::isDirectory);
        if (subs == null) {
            return null;
        }
        File best = null;
        long bestT = -1;
        for (File dir : subs) {
            File r =
                    new File(
                            dir,
                            "CaseDataExtract" + File.separator + UploadReceiptWriter.RECEIPT_FILENAME);
            if (r.isFile()) {
                long t = r.lastModified();
                if (t > bestT) {
                    bestT = t;
                    best = r;
                }
            }
        }
        return best;
    }

    private static void eq(String label, String a, String b) {
        if (!a.equals(b)) {
            throw new AssertionError(label + ": expected \"" + a + "\" got \"" + b + "\"");
        }
    }

    private static void eq(String label, long a, long b) {
        if (a != b) {
            throw new AssertionError(label + ": expected " + a + " got " + b);
        }
    }

    private static void eq(String label, int a, int b) {
        if (a != b) {
            throw new AssertionError(label + ": expected " + a + " got " + b);
        }
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? "" : String.valueOf(v);
    }

    private static long longVal(Object o) {
        if (o instanceof Number) {
            return ((Number) o).longValue();
        }
        return 0L;
    }
}
