package org.sleuthkit.autopsy.report.caseextract;

import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;
import org.openide.util.NbPreferences;

/**
 * Persists gateway URL, upload toggle, and chain mode via NetBeans preferences (Phase 3 S3.3).
 * Does not store token or signing password.
 */
final class CaseDataExtractUploadPreferences {

    private static final String KEY_GATEWAY_URL = "gatewayUrl";
    private static final String KEY_UPLOAD_ENABLED = "uploadEnabled";
    private static final String KEY_PROPOSAL_ENABLED = "proposalEnabled";
    private static final String KEY_CONTRACT_MODE = "contractMode";
    private static final String KEY_UPLOAD_REQUEST_TIMING = "uploadRequestTiming";

    private CaseDataExtractUploadPreferences() {}

    static void applyTo(CaseDataExtractReportModuleSettings target) {
        if (target == null) {
            return;
        }
        Preferences p = prefs();
        target.setGatewayUrl(p.get(KEY_GATEWAY_URL, "http://localhost:3000"));
        target.setUploadEnabled(p.getBoolean(KEY_UPLOAD_ENABLED, false));
        target.setProposalEnabled(p.getBoolean(KEY_PROPOSAL_ENABLED, false));
        target.setContractMode(p.get(KEY_CONTRACT_MODE, "contract"));
        target.setUploadRequestTiming(p.getBoolean(KEY_UPLOAD_REQUEST_TIMING, false));
    }

    static void saveFrom(CaseDataExtractReportModuleSettings source) {
        if (source == null) {
            return;
        }
        Preferences p = prefs();
        p.put(KEY_GATEWAY_URL, source.getGatewayUrl());
        p.putBoolean(KEY_UPLOAD_ENABLED, source.isUploadEnabled());
        p.putBoolean(KEY_PROPOSAL_ENABLED, source.isProposalEnabled());
        p.put(KEY_CONTRACT_MODE, source.getContractMode());
        p.putBoolean(KEY_UPLOAD_REQUEST_TIMING, source.isUploadRequestTiming());
        try {
            p.flush();
        } catch (BackingStoreException ignored) {
            // best-effort persistence
        }
    }

    private static Preferences prefs() {
        return NbPreferences.forModule(CaseDataExtractUploadPreferences.class);
    }
}
