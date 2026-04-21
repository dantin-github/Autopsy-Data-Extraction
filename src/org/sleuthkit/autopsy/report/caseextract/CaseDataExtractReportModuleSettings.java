package org.sleuthkit.autopsy.report.caseextract;

import org.sleuthkit.autopsy.report.ReportModuleSettings;

/**
 * Serializable settings for Case Data Extract report / blockchain upload (Phase 3+).
 */
public final class CaseDataExtractReportModuleSettings implements ReportModuleSettings {

    private static final long serialVersionUID = 1L;

    private String gatewayUrl = "http://localhost:3000";
    private boolean uploadEnabled;
    private String contractMode = "crud";

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
        return contractMode != null ? contractMode : "crud";
    }

    public void setContractMode(String contractMode) {
        this.contractMode = contractMode != null ? contractMode : "crud";
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
        o.contractMode = this.contractMode;
    }
}
