package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.util.Map;

/**
 * Successful POST /api/modify/propose-with-token JSON (fields match api-gateway modify route).
 */
public final class ProposalResponse {

    private final String proposalId;
    private final String caseId;
    private final String txHash;
    private final long blockNumber;
    private final String indexHash;
    private final String oldRecordHash;
    private final String newRecordHash;
    private final String pendingKey;

    public ProposalResponse(
            String proposalId,
            String caseId,
            String txHash,
            long blockNumber,
            String indexHash,
            String oldRecordHash,
            String newRecordHash,
            String pendingKey) {
        this.proposalId = proposalId;
        this.caseId = caseId;
        this.txHash = txHash;
        this.blockNumber = blockNumber;
        this.indexHash = indexHash;
        this.oldRecordHash = oldRecordHash;
        this.newRecordHash = newRecordHash;
        this.pendingKey = pendingKey;
    }

    public String getProposalId() {
        return proposalId;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getTxHash() {
        return txHash;
    }

    public long getBlockNumber() {
        return blockNumber;
    }

    public String getIndexHash() {
        return indexHash;
    }

    public String getOldRecordHash() {
        return oldRecordHash;
    }

    public String getNewRecordHash() {
        return newRecordHash;
    }

    public String getPendingKey() {
        return pendingKey;
    }

    public static ProposalResponse fromJson(String json) throws GatewayUploadException {
        if (json == null || json.isBlank()) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN, 0, "empty response body", null, null);
        }
        try {
            return fromMap(SimpleJson.parseObject(json.trim()));
        } catch (SimpleJson.JsonParseException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN, 0, "invalid JSON: " + e.getMessage(), null, null);
        }
    }

    static ProposalResponse fromMap(Map<String, Object> m) throws GatewayUploadException {
        String proposalId = str(m, "proposalId");
        String txHash = str(m, "txHash");
        if (proposalId == null || txHash == null) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN, 0, "missing proposalId or txHash in response", null, null);
        }
        Long blockNumber = longObj(m.get("blockNumber"));
        if (blockNumber == null) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.UNKNOWN, 0, "missing blockNumber", null, null);
        }
        return new ProposalResponse(
                proposalId,
                str(m, "caseId"),
                txHash,
                blockNumber,
                str(m, "indexHash"),
                str(m, "oldRecordHash"),
                str(m, "newRecordHash"),
                str(m, "pendingKey"));
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
}
