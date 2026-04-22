package org.sleuthkit.autopsy.report.caseextract;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayUploadException;
import org.sleuthkit.autopsy.report.caseextract.gateway.SimpleJson;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadResponse;

/**
 * Phase 5 S5.1: in-memory (and receipt-restorable) view of the last gateway upload for the open case, for the Monitor
 * tab and cross-restart continuity via {@code Reports/.../CaseDataExtract/upload_receipt.json}.
 */
public final class UploadSnapshot {

    /** Same basename as {@link CaseEventRecorder} writes next to {@link UploadReceiptWriter#RECEIPT_FILENAME}. */
    public static final String CASE_DATA_EXTRACT_REPORT_JSON = "case_data_extract.json";

    /** Mirrors {@link UploadReceiptWriter} path under each report run folder. */
    private static final String CASE_DATA_EXTRACT_DIR = "CaseDataExtract";

    private final String caseId;
    private final String status;
    private final Instant uploadStartedAt;
    private final Instant uploadResponseAt;
    private final long clientRoundTripMs;
    private final String requestId;
    private final Timing timing;
    private final String blockTimestampUtc;
    private final String indexHash;
    private final String recordHash;
    private final String txHash;
    private final Long blockNumber;
    private final String caseRegistryTxHash;
    private final Long caseRegistryBlockNumber;
    private final String errorKind;
    private final String errorMessage;
    private final int httpStatus;
    /** Receipt file lastModified when this snapshot was loaded from disk (0 if built in-session). */
    private final long receiptSourceLastModifiedMs;

    private UploadSnapshot(Builder b) {
        this.caseId = b.caseId != null ? b.caseId : "";
        this.status = b.status != null ? b.status : "";
        this.uploadStartedAt = b.uploadStartedAt;
        this.uploadResponseAt = b.uploadResponseAt;
        this.clientRoundTripMs = b.clientRoundTripMs;
        this.requestId = b.requestId != null ? b.requestId : "";
        this.timing = b.timing != null ? b.timing : Timing.EMPTY;
        this.blockTimestampUtc = b.blockTimestampUtc != null ? b.blockTimestampUtc : "";
        this.indexHash = b.indexHash != null ? b.indexHash : "";
        this.recordHash = b.recordHash != null ? b.recordHash : "";
        this.txHash = b.txHash != null ? b.txHash : "";
        this.blockNumber = b.blockNumber;
        this.caseRegistryTxHash = b.caseRegistryTxHash != null ? b.caseRegistryTxHash : "";
        this.caseRegistryBlockNumber = b.caseRegistryBlockNumber;
        this.errorKind = b.errorKind != null ? b.errorKind : "";
        this.errorMessage = b.errorMessage != null ? b.errorMessage : "";
        this.httpStatus = b.httpStatus;
        this.receiptSourceLastModifiedMs = b.receiptSourceLastModifiedMs;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getStatus() {
        return status;
    }

    public Instant getUploadStartedAt() {
        return uploadStartedAt;
    }

    public Instant getUploadResponseAt() {
        return uploadResponseAt;
    }

    public long getClientRoundTripMs() {
        return clientRoundTripMs;
    }

    public String getRequestId() {
        return requestId;
    }

    public Timing getTiming() {
        return timing;
    }

    public String getBlockTimestampUtc() {
        return blockTimestampUtc;
    }

    public String getIndexHash() {
        return indexHash;
    }

    public String getRecordHash() {
        return recordHash;
    }

    public String getTxHash() {
        return txHash;
    }

    public Long getBlockNumber() {
        return blockNumber;
    }

    public String getCaseRegistryTxHash() {
        return caseRegistryTxHash;
    }

    public Long getCaseRegistryBlockNumber() {
        return caseRegistryBlockNumber;
    }

    public String getErrorKind() {
        return errorKind;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    public long getReceiptSourceLastModifiedMs() {
        return receiptSourceLastModifiedMs;
    }

    /** Best-effort primary instant for display (upload end, or receipt file time when parsing). */
    public Instant getPrimaryInstant() {
        if (uploadResponseAt != null) {
            return uploadResponseAt;
        }
        if (uploadStartedAt != null) {
            return uploadStartedAt;
        }
        if (receiptSourceLastModifiedMs > 0) {
            return Instant.ofEpochMilli(receiptSourceLastModifiedMs);
        }
        return Instant.EPOCH;
    }

    public static UploadSnapshot fromSuccess(
            String caseId,
            Instant uploadStartedAt,
            Instant uploadResponseAt,
            long clientRoundTripMs,
            UploadResponse resp) {
        Builder b = new Builder();
        b.caseId = caseId;
        b.status = "success";
        b.uploadStartedAt = uploadStartedAt;
        b.uploadResponseAt = uploadResponseAt;
        b.clientRoundTripMs = clientRoundTripMs;
        if (resp != null) {
            b.requestId = resp.getRequestId();
            if (resp.getTiming() != null) {
                UploadResponse.UploadTiming t = resp.getTiming();
                b.timing =
                        new Timing(
                                t.getIntegrityMs(),
                                t.getChainMs(),
                                t.getTotalMs(),
                                t.hasCaseRegistryMs() ? t.getCaseRegistryMs() : null);
            }
            b.blockTimestampUtc = resp.getBlockTimestampUtc();
            b.indexHash = resp.getIndexHash();
            b.recordHash = resp.getRecordHash();
            b.txHash = resp.getTxHash();
            b.blockNumber = resp.getBlockNumber();
            b.caseRegistryTxHash = resp.getCaseRegistryTxHash();
            b.caseRegistryBlockNumber = resp.getCaseRegistryBlockNumber();
        }
        return new UploadSnapshot(b);
    }

    public static UploadSnapshot fromFailure(
            String caseId,
            Instant uploadStartedAt,
            Instant uploadResponseAt,
            long clientRoundTripMs,
            GatewayUploadException e) {
        Builder b = new Builder();
        b.caseId = caseId;
        b.status = "failed";
        b.uploadStartedAt = uploadStartedAt;
        b.uploadResponseAt = uploadResponseAt;
        b.clientRoundTripMs = clientRoundTripMs;
        if (e != null) {
            b.errorKind = e.getKind().name();
            b.httpStatus = e.getHttpStatus();
            b.errorMessage = e.getMessage() != null ? e.getMessage() : "";
        }
        return new UploadSnapshot(b);
    }

    public static UploadSnapshot fromCancelled(
            String caseId, Instant uploadStartedAt, Instant uploadResponseAt, long clientRoundTripMs) {
        Builder b = new Builder();
        b.caseId = caseId;
        b.status = "cancelled";
        b.uploadStartedAt = uploadStartedAt;
        b.uploadResponseAt = uploadResponseAt;
        b.clientRoundTripMs = clientRoundTripMs;
        b.errorKind = "CANCELLED";
        b.errorMessage = "user_cancelled";
        return new UploadSnapshot(b);
    }

    /** In-memory only (no {@code upload_receipt.json}); e.g. invalid URL or missing token. */
    public static UploadSnapshot fromSkipped(String caseId, String reasonCode) {
        Builder b = new Builder();
        b.caseId = caseId != null ? caseId : "";
        b.status = "skipped";
        b.errorKind = "SKIPPED";
        b.errorMessage = reasonCode != null ? reasonCode : "";
        b.uploadResponseAt = Instant.now();
        return new UploadSnapshot(b);
    }

    /**
     * Latest receipt under {@code Reports} (each report folder's {@code CaseDataExtract/upload_receipt.json}) by file
     * mtime; enriches {@code caseId} from sibling {@code case_data_extract.json} when absent in the receipt.
     */
    public static UploadSnapshot loadLatestFromCaseReports(String caseDirectory) {
        File receipt = findLatestReceiptFile(caseDirectory);
        if (receipt == null || !receipt.isFile()) {
            return null;
        }
        try {
            String json = readUtf8File(receipt);
            String caseId = extractCaseIdFromSiblingReport(receipt);
            return fromReceiptJson(json, caseId, receipt.lastModified());
        } catch (Exception e) {
            return null;
        }
    }

    static UploadSnapshot fromReceiptJson(String json, String caseIdHint, long receiptLastModifiedMs)
            throws SimpleJson.JsonParseException {
        Map<String, Object> m = SimpleJson.parseObject(json);
        Builder b = new Builder();
        b.receiptSourceLastModifiedMs = receiptLastModifiedMs;
        b.caseId = caseIdHint != null ? caseIdHint : "";
        b.status = str(m, "uploadStatus");
        b.uploadStartedAt = parseInstant(str(m, "uploadStartedAt"));
        b.uploadResponseAt = parseInstant(str(m, "uploadResponseAt"));
        b.clientRoundTripMs = longVal(m.get("clientRoundTripMs"), 0L);
        b.requestId = str(m, "requestId");
        b.blockTimestampUtc = str(m, "blockTimestampUtc");
        b.indexHash = str(m, "indexHash");
        b.recordHash = str(m, "recordHash");
        b.txHash = str(m, "txHash");
        b.blockNumber = longObject(m.get("blockNumber"));
        b.caseRegistryTxHash = str(m, "caseRegistryTxHash");
        b.caseRegistryBlockNumber = longObject(m.get("caseRegistryBlockNumber"));
        b.errorKind = str(m, "errorKind");
        b.errorMessage = str(m, "errorMessage");
        b.httpStatus = (int) longVal(m.get("httpStatus"), 0L);
        b.timing = timingFromMap(m.get("timing"));
        return new UploadSnapshot(b);
    }

    private static Timing timingFromMap(Object o) {
        if (!(o instanceof Map)) {
            return Timing.EMPTY;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) o;
        Long cr = longObject(m.get("caseRegistryMs"));
        return new Timing(
                longVal(m.get("integrityMs"), 0L),
                longVal(m.get("chainMs"), 0L),
                longVal(m.get("totalMs"), 0L),
                cr);
    }

    private static File findLatestReceiptFile(String caseDirectory) {
        File reportsDir = new File(caseDirectory, "Reports");
        if (!reportsDir.isDirectory()) {
            return null;
        }
        File[] subDirs = reportsDir.listFiles(File::isDirectory);
        if (subDirs == null || subDirs.length == 0) {
            return null;
        }
        File best = null;
        long bestTime = -1;
        for (File dir : subDirs) {
            File r =
                    new File(
                            dir,
                            CASE_DATA_EXTRACT_DIR + File.separator + UploadReceiptWriter.RECEIPT_FILENAME);
            if (r.isFile()) {
                long t = r.lastModified();
                if (t > bestTime) {
                    bestTime = t;
                    best = r;
                }
            }
        }
        return best;
    }

    private static String extractCaseIdFromSiblingReport(File receiptFile) {
        File parent = receiptFile.getParentFile();
        if (parent == null) {
            return "";
        }
        File caseJson = new File(parent, CASE_DATA_EXTRACT_REPORT_JSON);
        if (!caseJson.isFile()) {
            return "";
        }
        try {
            return extractCaseIdField(readUtf8File(caseJson));
        } catch (IOException e) {
            return "";
        }
    }

    private static String extractCaseIdField(String json) {
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

    private static String readUtf8File(File f) throws IOException {
        try (FileReader r = new FileReader(f, StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder((int) Math.min(f.length(), Integer.MAX_VALUE));
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) {
                sb.append(buf, 0, n);
            }
            return sb.toString();
        }
    }

    private static Instant parseInstant(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? "" : Objects.toString(v, "");
    }

    private static long longVal(Object o, long def) {
        if (o instanceof Number) {
            return ((Number) o).longValue();
        }
        return def;
    }

    private static Long longObject(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Number) {
            return ((Number) o).longValue();
        }
        return null;
    }

    /** Server-reported phase timings (optional {@code caseRegistryMs}). */
    public static final class Timing {
        public static final Timing EMPTY = new Timing(0, 0, 0, null);

        private final long integrityMs;
        private final long chainMs;
        private final long totalMs;
        private final Long caseRegistryMs;

        public Timing(long integrityMs, long chainMs, long totalMs, Long caseRegistryMs) {
            this.integrityMs = integrityMs;
            this.chainMs = chainMs;
            this.totalMs = totalMs;
            this.caseRegistryMs = caseRegistryMs;
        }

        public long getIntegrityMs() {
            return integrityMs;
        }

        public long getChainMs() {
            return chainMs;
        }

        public long getTotalMs() {
            return totalMs;
        }

        public Long getCaseRegistryMs() {
            return caseRegistryMs;
        }

        public boolean hasCaseRegistryMs() {
            return caseRegistryMs != null;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Timing)) {
                return false;
            }
            Timing t = (Timing) o;
            return integrityMs == t.integrityMs
                    && chainMs == t.chainMs
                    && totalMs == t.totalMs
                    && Objects.equals(caseRegistryMs, t.caseRegistryMs);
        }

        @Override
        public int hashCode() {
            return Arrays.hashCode(new Object[] {integrityMs, chainMs, totalMs, caseRegistryMs});
        }
    }

    private static final class Builder {
        String caseId;
        String status;
        Instant uploadStartedAt;
        Instant uploadResponseAt;
        long clientRoundTripMs;
        String requestId;
        Timing timing;
        String blockTimestampUtc;
        String indexHash;
        String recordHash;
        String txHash;
        Long blockNumber;
        String caseRegistryTxHash;
        Long caseRegistryBlockNumber;
        String errorKind;
        String errorMessage;
        int httpStatus;
        long receiptSourceLastModifiedMs;
    }
}
