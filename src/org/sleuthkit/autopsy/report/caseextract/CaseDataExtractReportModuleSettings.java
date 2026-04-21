package org.sleuthkit.autopsy.report.caseextract;

import org.sleuthkit.autopsy.report.ReportModuleSettings;

/**
 * Serializable settings for Case Data Extract report / blockchain upload (Phase 3+).
 */
public final class CaseDataExtractReportModuleSettings implements ReportModuleSettings {

    private static final long serialVersionUID = 1L;

    private String gatewayUrl = "http://localhost:3000";
    private boolean uploadEnabled;
    /** Always CaseRegistry path; legacy "crud" from older configs is ignored at upload time. */
    private String contractMode = "contract";

    /** Session-only; not serialized (NbPreferences will not store this in S3.3). */
    private transient String oneTimeToken = "";

    private transient String signingPassword = "";

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
        o.contractMode = normalizeContractMode(this.contractMode);
        o.oneTimeToken = this.oneTimeToken;
        o.signingPassword = this.signingPassword;
    }
}
