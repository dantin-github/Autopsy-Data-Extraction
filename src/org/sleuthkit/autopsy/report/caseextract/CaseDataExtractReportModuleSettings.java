package org.sleuthkit.autopsy.report.caseextract;

import org.sleuthkit.autopsy.report.ReportModuleSettings;

/**
 * Serializable settings for Case Data Extract report / blockchain upload (Phase 3+).
 */
public final class CaseDataExtractReportModuleSettings implements ReportModuleSettings {

    private static final long serialVersionUID = 4L;

    private String gatewayUrl = "http://localhost:3000";
    private boolean uploadEnabled;
    /** Mutually exclusive with {@link #uploadEnabled} in UI; propose-with-token path (P3). */
    private boolean proposalEnabled;
    /** Session-only reason for modification proposal; not written to {@link CaseDataExtractUploadPreferences}. */
    private String proposalReason = "";
    /** Always CaseRegistry path; legacy "crud" from older configs is ignored at upload time. */
    private String contractMode = "contract";

    /**
     * Police OTP / X-Auth-Token. Must be part of normal Java serialization: Autopsy copies report module settings
     * for the generation task, and {@code transient} fields are dropped, which caused empty token at upload time.
     * {@link CaseDataExtractUploadPreferences} still does not write this to NbPreferences.
     */
    private String oneTimeToken = "";

    /** Keystore signing password for CaseRegistry upload; same serialization note as {@link #oneTimeToken}. */
    private String signingPassword = "";

    /**
     * When true, {@code POST /api/upload} sends {@code X-Debug-Timing: 1} so the gateway may return timing fields
     * (Phase 4 S4.2). Persisted via {@link CaseDataExtractUploadPreferences}; not secret.
     */
    private boolean uploadRequestTiming;

    public CaseDataExtractReportModuleSettings() {
    }

    @Override
    public long getVersionNumber() {
        return serialVersionUID;
    }

    public String getGatewayUrl() {
        return gatewayUrl != null ? gatewayUrl : "";
    }

    public void setGatewayUrl(String gatewayUrl) {
        this.gatewayUrl = gatewayUrl != null ? gatewayUrl : "";
    }

    public boolean isUploadEnabled() {
        return uploadEnabled;
    }

    public void setUploadEnabled(boolean uploadEnabled) {
        this.uploadEnabled = uploadEnabled;
    }

    public boolean isProposalEnabled() {
        return proposalEnabled;
    }

    public void setProposalEnabled(boolean proposalEnabled) {
        this.proposalEnabled = proposalEnabled;
    }

    public String getProposalReason() {
        return proposalReason != null ? proposalReason : "";
    }

    public void setProposalReason(String proposalReason) {
        this.proposalReason = proposalReason != null ? proposalReason : "";
    }

    public String getContractMode() {
        return normalizeContractMode(contractMode);
    }

    public void setContractMode(String contractMode) {
        this.contractMode = normalizeContractMode(contractMode);
    }

    private static String normalizeContractMode(String mode) {
        if (mode == null || mode.isBlank() || "crud".equalsIgnoreCase(mode.trim())) {
            return "contract";
        }
        return mode.trim();
    }

    public String getOneTimeToken() {
        return oneTimeToken != null ? oneTimeToken : "";
    }

    public void setOneTimeToken(String oneTimeToken) {
        this.oneTimeToken = oneTimeToken != null ? oneTimeToken : "";
    }

    public String getSigningPassword() {
        return signingPassword != null ? signingPassword : "";
    }

    public void setSigningPassword(String signingPassword) {
        this.signingPassword = signingPassword != null ? signingPassword : "";
    }

    public boolean isUploadRequestTiming() {
        return uploadRequestTiming;
    }

    public void setUploadRequestTiming(boolean uploadRequestTiming) {
        this.uploadRequestTiming = uploadRequestTiming;
    }

    CaseDataExtractReportModuleSettings copy() {
        CaseDataExtractReportModuleSettings o = new CaseDataExtractReportModuleSettings();
        copyTo(o);
        return o;
    }

    void copyTo(CaseDataExtractReportModuleSettings o) {
        if (o == null) {
            return;
        }
        o.gatewayUrl = this.gatewayUrl;
        o.uploadEnabled = this.uploadEnabled;
        o.proposalEnabled = this.proposalEnabled;
        o.proposalReason = this.proposalReason;
        o.contractMode = normalizeContractMode(this.contractMode);
        o.oneTimeToken = this.oneTimeToken;
        o.signingPassword = this.signingPassword;
        o.uploadRequestTiming = this.uploadRequestTiming;
    }
}
