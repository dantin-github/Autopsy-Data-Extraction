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
    private static final String KEY_CONTRACT_MODE = "contractMode";

    private CaseDataExtractUploadPreferences() {}

    static void applyTo(CaseDataExtractReportModuleSettings target) {
        if (target == null) {
            return;
        }
        Preferences p = prefs();
        target.setGatewayUrl(p.get(KEY_GATEWAY_URL, "http://localhost:3000"));
        target.setUploadEnabled(p.getBoolean(KEY_UPLOAD_ENABLED, false));
        target.setContractMode(p.get(KEY_CONTRACT_MODE, "contract"));
    }

    static void saveFrom(CaseDataExtractReportModuleSettings source) {
        if (source == null) {
            return;
        }
        Preferences p = prefs();
        p.put(KEY_GATEWAY_URL, source.getGatewayUrl());
        p.putBoolean(KEY_UPLOAD_ENABLED, source.isUploadEnabled());
        p.put(KEY_CONTRACT_MODE, source.getContractMode());
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
