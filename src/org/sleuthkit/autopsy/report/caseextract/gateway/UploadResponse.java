package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.util.Map;

/**
 * Successful POST /api/upload JSON (subset used by the plugin).
 */
public final class UploadResponse {

    private final String indexHash;
    private final String recordHash;
    private final String txHash;
    private final long blockNumber;
    private final String caseRegistryTxHash;
    private final Long caseRegistryBlockNumber;
    private final String requestId;
    private final String blockTimestampUtc;
    private final UploadTiming timing;

    public UploadResponse(
            String indexHash,
            String recordHash,
            String txHash,
            long blockNumber,
            String caseRegistryTxHash,
            Long caseRegistryBlockNumber,
            String requestId,
            String blockTimestampUtc,
            UploadTiming timing) {
        this.indexHash = indexHash;
        this.recordHash = recordHash;
        this.txHash = txHash;
        this.blockNumber = blockNumber;
        this.caseRegistryTxHash = caseRegistryTxHash;
        this.caseRegistryBlockNumber = caseRegistryBlockNumber;
        this.requestId = requestId;
        this.blockTimestampUtc = blockTimestampUtc;
        this.timing = timing;
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

    public long getBlockNumber() {
        return blockNumber;
    }

    public String getCaseRegistryTxHash() {
        return caseRegistryTxHash;
    }

    public Long getCaseRegistryBlockNumber() {
        return caseRegistryBlockNumber;
    }

    public String getRequestId() {
        return requestId;
    }

    public String getBlockTimestampUtc() {
        return blockTimestampUtc;
    }

    public UploadTiming getTiming() {
        return timing;
    }

    public static UploadResponse fromJson(String json) throws GatewayUploadException {
        if (json == null || json.isBlank()) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN,
                    0,
                    "empty response body",
                    null,
                    null);
        }
        try {
            Map<String, Object> m = SimpleJson.parseObject(json.trim());
            return fromMap(m);
        } catch (SimpleJson.JsonParseException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN,
                    0,
                    "invalid JSON: " + e.getMessage(),
                    null,
                    null);
        }
    }

    @SuppressWarnings("unchecked")
    static UploadResponse fromMap(Map<String, Object> m) throws GatewayUploadException {
        String indexHash = str(m, "indexHash");
        String recordHash = str(m, "recordHash");
        String txHash = str(m, "txHash");
        if (indexHash == null || recordHash == null || txHash == null) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN,
                    0,
                    "missing hash fields in response",
                    null,
                    null);
        }
        Long blockNumber = longObj(m.get("blockNumber"));
        if (blockNumber == null) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN,
                    0,
                    "missing blockNumber",
                    null,
                    null);
        }
        String caseRegistryTxHash = str(m, "caseRegistryTxHash");
        Long caseRegistryBlockNumber = longObj(m.get("caseRegistryBlockNumber"));
        String requestId = str(m, "requestId");
        String blockTimestampUtc = str(m, "blockTimestampUtc");
        UploadTiming timing = null;
        Object t = m.get("timing");
        if (t instanceof Map) {
            timing = UploadTiming.fromMap((Map<String, Object>) t);
        }
        return new UploadResponse(
                indexHash,
                recordHash,
                txHash,
                blockNumber,
                caseRegistryTxHash,
                caseRegistryBlockNumber,
                requestId,
                blockTimestampUtc,
                timing);
    }

    private static String str(Map<String, Object> m, String k) {
        Object o = m.get(k);
        return o instanceof String ? (String) o : null;
    }

    private static Long longObj(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Long) {
            return (Long) o;
        }
        if (o instanceof Integer) {
            return ((Integer) o).longValue();
        }
        if (o instanceof Double) {
            return ((Double) o).longValue();
        }
        return null;
    }

    /** Optional timing object when {@code X-Debug-Timing: 1} or env timing flag is on. */
    public static final class UploadTiming {

        private final long integrityMs;
        private final long chainMs;
        private final long caseRegistryMs;
        private final long totalMs;
        private final boolean hasCaseRegistryMs;

        public UploadTiming(
                long integrityMs,
                long chainMs,
                long caseRegistryMs,
                long totalMs,
                boolean hasCaseRegistryMs) {
            this.integrityMs = integrityMs;
            this.chainMs = chainMs;
            this.caseRegistryMs = caseRegistryMs;
            this.totalMs = totalMs;
            this.hasCaseRegistryMs = hasCaseRegistryMs;
        }

        static UploadTiming fromMap(Map<String, Object> m) {
            long integrity = longFrom(m.get("integrityMs"));
            long chain = longFrom(m.get("chainMs"));
            long total = longFrom(m.get("totalMs"));
            boolean hasReg = m.containsKey("caseRegistryMs");
            long reg = longFrom(m.get("caseRegistryMs"));
            return new UploadTiming(integrity, chain, reg, total, hasReg);
        }

        private static long longFrom(Object o) {
            if (o instanceof Long) {
                return (Long) o;
            }
            if (o instanceof Integer) {
                return ((Integer) o).longValue();
            }
            if (o instanceof Double) {
                return ((Double) o).longValue();
            }
            return 0L;
        }

        public long getIntegrityMs() {
            return integrityMs;
        }

        public long getChainMs() {
            return chainMs;
        }

        public long getCaseRegistryMs() {
            return caseRegistryMs;
        }

        public long getTotalMs() {
            return totalMs;
        }

        public boolean hasCaseRegistryMs() {
            return hasCaseRegistryMs;
        }
    }
}
