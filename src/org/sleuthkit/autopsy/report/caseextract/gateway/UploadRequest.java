package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.util.Objects;

/**
 * POST /api/upload body (fields match api-gateway upload route).
 */
public final class UploadRequest {

    private final String caseId;
    private final String examiner;
    private final String aggregateHash;
    private final String generatedAt;
    private final String caseJson;
    private final String signingPassword;

    public UploadRequest(
            String caseId,
            String examiner,
            String aggregateHash,
            String generatedAt,
            String caseJson) {
        this(caseId, examiner, aggregateHash, generatedAt, caseJson, null);
    }

    public UploadRequest(
            String caseId,
            String examiner,
            String aggregateHash,
            String generatedAt,
            String caseJson,
            String signingPassword) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.examiner = Objects.requireNonNull(examiner, "examiner");
        this.aggregateHash = Objects.requireNonNull(aggregateHash, "aggregateHash");
        this.generatedAt = Objects.requireNonNull(generatedAt, "generatedAt");
        this.caseJson = Objects.requireNonNull(caseJson, "caseJson");
        this.signingPassword = signingPassword;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getExaminer() {
        return examiner;
    }

    public String getAggregateHash() {
        return aggregateHash;
    }

    public String getGeneratedAt() {
        return generatedAt;
    }

    public String getCaseJson() {
        return caseJson;
    }

    public String getSigningPassword() {
        return signingPassword;
    }

    public UploadRequest withSigningPassword(String password) {
        return new UploadRequest(caseId, examiner, aggregateHash, generatedAt, caseJson, password);
    }

    public String toJson() {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"caseId\":").append(JsonStrings.quote(caseId));
        sb.append(",\"examiner\":").append(JsonStrings.quote(examiner));
        sb.append(",\"aggregateHash\":").append(JsonStrings.quote(aggregateHash));
        sb.append(",\"generatedAt\":").append(JsonStrings.quote(generatedAt));
        sb.append(",\"caseJson\":").append(JsonStrings.quote(caseJson));
        if (signingPassword != null && !signingPassword.isEmpty()) {
            sb.append(",\"signingPassword\":").append(JsonStrings.quote(signingPassword));
        }
        sb.append('}');
        return sb.toString();
    }
}
