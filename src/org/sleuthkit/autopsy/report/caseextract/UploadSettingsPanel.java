package org.sleuthkit.autopsy.report.caseextract;

import java.awt.BorderLayout;
import javax.swing.JLabel;
import javax.swing.JPanel;

/**
 * Report wizard configuration UI for gateway upload (full layout in S3.2).
 */
final class UploadSettingsPanel extends JPanel {

    private static final long serialVersionUID = 1L;

    private final JLabel hintLabel;
    private CaseDataExtractReportModuleSettings model = new CaseDataExtractReportModuleSettings();

    UploadSettingsPanel() {
        super(new BorderLayout(8, 8));
        hintLabel =
                new JLabel(
                        "<html><div style=\"width:360px\">"
                                + "Gateway URL, upload options, OTP, signing password, and Test Connection "
                                + "will appear here when the settings layout is added."
                                + "</div></html>");
        add(hintLabel, BorderLayout.NORTH);
    }

    void loadFrom(CaseDataExtractReportModuleSettings s) {
        model = s != null ? s.copy() : new CaseDataExtractReportModuleSettings();
    }

    void saveTo(CaseDataExtractReportModuleSettings target) {
        if (target == null) {
            return;
        }
        model.copyTo(target);
    }
}
