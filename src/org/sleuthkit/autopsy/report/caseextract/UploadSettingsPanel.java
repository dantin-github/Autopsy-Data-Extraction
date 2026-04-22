package org.sleuthkit.autopsy.report.caseextract;

import java.awt.Color;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ItemEvent;
import java.util.regex.Pattern;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayClient;
import org.sleuthkit.autopsy.report.caseextract.gateway.PingResult;

/**
 * Report wizard configuration UI for gateway upload (Phase 3 §5.1 / S3.2, URL validation S3.4).
 * Chain path is CaseRegistry only ({@code contract}); gateway {@code CHAIN_MODE=contract}.
 */
final class UploadSettingsPanel extends JPanel {

    private static final long serialVersionUID = 1L;

    /** Same as plan S3.4; applied early for invalid URL feedback next to field. */
    private static final Pattern GATEWAY_URL_PATTERN =
            Pattern.compile("^https?://[\\w.\\-]+(:\\d+)?(/.*)?$");

    private static final int LABEL_WIDTH = 100;

    private final JTextField gatewayUrlField = new JTextField(24);
    private final JLabel gatewayUrlError = new JLabel("!");
    private final JCheckBox uploadAfterSaveCheck = new JCheckBox("Upload after save");
    private final JCheckBox uploadTimingCheck =
            new JCheckBox("Request upload timing (X-Debug-Timing)");
    private final JPasswordField otpField = new JPasswordField(24);
    private final JPasswordField signingPasswordField = new JPasswordField(24);
    private final JButton testConnectionButton = new JButton("Test Connection");
    private final JLabel connectionStatusLabel = new JLabel("Not tested");

    /** Suppress ItemListener side effects while programmatically reverting upload (S3.4). */
    private boolean revertingUploadForInvalidUrl;

    UploadSettingsPanel() {
        super(new GridBagLayout());
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        gatewayUrlError.setForeground(Color.RED);
        gatewayUrlError.setVisible(false);
        gatewayUrlError.setToolTipText(
                "Expected: http:// or https://, host (letters, digits, ., -), optional :port, optional path. "
                        + "Example: http://localhost:3000");

        uploadAfterSaveCheck.addItemListener(
                e -> {
                    if (revertingUploadForInvalidUrl) {
                        applyUploadDependentEnabledState();
                        return;
                    }
                    if (e.getStateChange() == ItemEvent.SELECTED) {
                        if (!isGatewayUrlValid()) {
                            revertingUploadForInvalidUrl = true;
                            SwingUtilities.invokeLater(
                                    () -> {
                                        uploadAfterSaveCheck.setSelected(false);
                                        connectionStatusLabel.setForeground(Color.RED);
                                        String t = gatewayUrlField.getText().trim();
                                        connectionStatusLabel.setText(
                                                t.isEmpty()
                                                        ? "Enter a valid gateway URL before enabling upload."
                                                        : "Invalid gateway URL. Fix the URL before enabling upload.");
                                        revertingUploadForInvalidUrl = false;
                                        applyUploadDependentEnabledState();
                                    });
                            return;
                        }
                    }
                    if (e.getStateChange() == ItemEvent.DESELECTED) {
                        connectionStatusLabel.setText("Not tested");
                        connectionStatusLabel.setForeground(null);
                    }
                    applyUploadDependentEnabledState();
                });

        gatewayUrlField
                .getDocument()
                .addDocumentListener(
                        new DocumentListener() {
                            @Override
                            public void insertUpdate(DocumentEvent e) {
                                refreshUrlErrorIndicator();
                            }

                            @Override
                            public void removeUpdate(DocumentEvent e) {
                                refreshUrlErrorIndicator();
                            }

                            @Override
                            public void changedUpdate(DocumentEvent e) {
                                refreshUrlErrorIndicator();
                            }
                        });

        testConnectionButton.addActionListener(e -> runTestConnection());

        uploadTimingCheck.setToolTipText(
                "When enabled, the gateway may include timing fields in the upload response (diagnostics).");

        int row = 0;
        addRow(
                row++,
                label("Gateway Base URL"),
                gatewayUrlRow());
        addRow(row++, label(" "), uploadAfterSaveCheck);
        addRow(row++, label(" "), uploadTimingCheck);
        addRow(row++, label("Token"), otpField);
        addRow(row++, label("Signing password"), signingPasswordField);
        addRow(row++, label(" "), testConnectionRow());

        applyUploadDependentEnabledState();
    }

    private static JLabel label(String text) {
        JLabel l = new JLabel(text);
        l.setHorizontalAlignment(SwingConstants.RIGHT);
        l.setPreferredSize(new Dimension(LABEL_WIDTH, l.getPreferredSize().height));
        return l;
    }

    private JPanel gatewayUrlRow() {
        JPanel p = new JPanel();
        p.setLayout(new BoxLayout(p, BoxLayout.X_AXIS));
        gatewayUrlField.setToolTipText("e.g. http://localhost:3000");
        p.add(gatewayUrlField);
        p.add(Box.createHorizontalStrut(4));
        p.add(gatewayUrlError);
        p.add(Box.createHorizontalGlue());
        return p;
    }

    private JPanel testConnectionRow() {
        JPanel p = new JPanel();
        p.setLayout(new BoxLayout(p, BoxLayout.X_AXIS));
        p.add(testConnectionButton);
        p.add(Box.createHorizontalStrut(12));
        p.add(connectionStatusLabel);
        p.add(Box.createHorizontalGlue());
        return p;
    }

    private void addRow(int row, JLabel label, java.awt.Component field) {
        GridBagConstraints c = new GridBagConstraints();
        c.gridx = 0;
        c.gridy = row;
        c.anchor = GridBagConstraints.EAST;
        c.insets = new Insets(4, 4, 4, 8);
        c.weightx = 0;
        add(label, c);
        c.gridx = 1;
        c.anchor = GridBagConstraints.WEST;
        c.fill = GridBagConstraints.HORIZONTAL;
        c.weightx = 1;
        add(field, c);
    }

    private void applyUploadDependentEnabledState() {
        boolean up = uploadAfterSaveCheck.isSelected();
        uploadTimingCheck.setEnabled(up);
        otpField.setEnabled(up);
        signingPasswordField.setEnabled(up);
        testConnectionButton.setEnabled(up);
        if (!up) {
            connectionStatusLabel.setForeground(null);
        }
    }

    private void refreshUrlErrorIndicator() {
        String t = gatewayUrlField.getText().trim();
        boolean bad = !t.isEmpty() && !GATEWAY_URL_PATTERN.matcher(t).matches();
        gatewayUrlError.setVisible(bad);
        if (!isGatewayUrlValid()) {
            clearStaleConnectionOk();
        }
    }

    /** Drop a green \"OK · N ms\" after the URL no longer validates (S3.4). */
    private void clearStaleConnectionOk() {
        String s = connectionStatusLabel.getText();
        if (s != null && s.startsWith("OK ·")) {
            connectionStatusLabel.setText("Not tested");
            connectionStatusLabel.setForeground(null);
        }
    }

    private boolean isGatewayUrlValid() {
        String t = gatewayUrlField.getText().trim();
        return !t.isEmpty() && GATEWAY_URL_PATTERN.matcher(t).matches();
    }

    private void runTestConnection() {
        if (!uploadAfterSaveCheck.isSelected()) {
            return;
        }
        String base = gatewayUrlField.getText().trim();
        if (!isGatewayUrlValid()) {
            connectionStatusLabel.setForeground(Color.RED);
            connectionStatusLabel.setText("Invalid gateway URL");
            return;
        }
        connectionStatusLabel.setForeground(null);
        connectionStatusLabel.setText("Testing…");
        testConnectionButton.setEnabled(false);

        SwingWorker<PingResult, Void> worker =
                new SwingWorker<>() {
                    @Override
                    protected PingResult doInBackground() {
                        return new GatewayClient().ping(base);
                    }

                    @Override
                    protected void done() {
                        testConnectionButton.setEnabled(uploadAfterSaveCheck.isSelected());
                        try {
                            PingResult p = get();
                            if (p.isOk()) {
                                connectionStatusLabel.setForeground(new Color(0, 128, 0));
                                connectionStatusLabel.setText("OK · " + p.getLatencyMs() + " ms");
                            } else {
                                connectionStatusLabel.setForeground(Color.RED);
                                String m = p.getMessage();
                                if (m != null && m.toLowerCase().startsWith("unreachable:")) {
                                    connectionStatusLabel.setText(
                                            "Unreachable: " + m.substring("unreachable:".length()).trim());
                                } else {
                                    connectionStatusLabel.setText(
                                            m != null && !m.isEmpty() ? m : "Unreachable");
                                }
                            }
                        } catch (Exception ex) {
                            connectionStatusLabel.setForeground(Color.RED);
                            String msg = ex.getMessage();
                            connectionStatusLabel.setText(
                                    "Unreachable: " + (msg != null ? msg : ex.getClass().getSimpleName()));
                        }
                    }
                };
        worker.execute();
    }

    void loadFrom(CaseDataExtractReportModuleSettings s) {
        CaseDataExtractReportModuleSettings src =
                s != null ? s : new CaseDataExtractReportModuleSettings();
        gatewayUrlField.setText(src.getGatewayUrl());
        boolean up = src.isUploadEnabled();
        uploadAfterSaveCheck.setSelected(up && isGatewayUrlValidFor(src.getGatewayUrl()));
        uploadTimingCheck.setSelected(src.isUploadRequestTiming());
        otpField.setText(src.getOneTimeToken());
        signingPasswordField.setText(src.getSigningPassword());
        connectionStatusLabel.setText("Not tested");
        connectionStatusLabel.setForeground(null);
        refreshUrlErrorIndicator();
        applyUploadDependentEnabledState();
        SwingUtilities.invokeLater(this::revalidate);
    }

    void saveTo(CaseDataExtractReportModuleSettings target) {
        if (target == null) {
            return;
        }
        String url = gatewayUrlField.getText().trim();
        target.setGatewayUrl(url);
        boolean up = uploadAfterSaveCheck.isSelected();
        target.setUploadEnabled(up && isGatewayUrlValidFor(url));
        target.setContractMode("contract");
        target.setUploadRequestTiming(uploadTimingCheck.isSelected());
        target.setOneTimeToken(new String(otpField.getPassword()));
        target.setSigningPassword(new String(signingPasswordField.getPassword()));
    }

    private boolean isGatewayUrlValidFor(String url) {
        if (url == null || url.isEmpty()) {
            return false;
        }
        return GATEWAY_URL_PATTERN.matcher(url.trim()).matches();
    }
}
