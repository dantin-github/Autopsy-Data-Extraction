package org.sleuthkit.autopsy.report.caseextract;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Font;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import javax.swing.BoxLayout;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTabbedPane;
import javax.swing.ScrollPaneConstants;
import javax.swing.SwingUtilities;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import org.openide.windows.TopComponent;
import org.openide.util.NbBundle;
import org.openide.util.lookup.Lookups;

/**
 * Status window: shows whether the plugin is running correctly and what
 * operations have been recorded for the current case.
 */
@TopComponent.Description(preferredID = "CaseDataExtractMonitorTopComponent", persistenceType = TopComponent.PERSISTENCE_NEVER)
@TopComponent.Registration(mode = "output", openAtStartup = false)
@NbBundle.Messages({"CTL_CaseDataExtractMonitor=Case Data Extract Status"})
public final class CaseDataExtractMonitorTopComponent extends TopComponent {

    private static final int REFRESH_INTERVAL_MS = 2000;
    private final JLabel statusLabel;
    private final JLabel captureLabel;
    private final JLabel summaryLabel;
    private final DefaultTableModel tableModel;
    private final DefaultTableModel integrityModel;
    private final DefaultTableModel uploadModel;
    private final JTable uploadTable;
    private final JLabel uploadEmptyLabel;
    private final JLabel uploadBannerLabel;
    private final JScrollPane uploadScroll;
    private volatile boolean refreshRunning;
    private Thread refreshThread;

    public CaseDataExtractMonitorTopComponent() {
        setLayout(new BorderLayout(5, 5));
        setDisplayName(NbBundle.getMessage(CaseDataExtractMonitorTopComponent.class, "CTL_CaseDataExtractMonitor"));

        // ---- North: status labels ----
        JPanel north = new JPanel(new BorderLayout(5, 5));
        statusLabel = new JLabel("Status: Loading...");
        statusLabel.setFont(statusLabel.getFont().deriveFont(Font.BOLD, 12f));
        north.add(statusLabel, BorderLayout.NORTH);
        captureLabel = new JLabel("Capture: --");
        north.add(captureLabel, BorderLayout.CENTER);
        summaryLabel = new JLabel("Summary: --");
        north.add(summaryLabel, BorderLayout.SOUTH);
        add(north, BorderLayout.NORTH);

        // ---- Center: tabbed pane ----
        JTabbedPane tabs = new JTabbedPane();

        // Tab 1: Operations log
        tableModel = new DefaultTableModel(new String[]{"Time", "Action", "Operator", "Detail"}, 0) {
            @Override public boolean isCellEditable(int r, int c) { return false; }
        };
        JTable opsTable = new JTable(tableModel);
        opsTable.setAutoCreateRowSorter(true);
        tabs.addTab("Operations Log", new JScrollPane(opsTable));

        // Tab 2: Image Integrity
        integrityModel = new DefaultTableModel(
                new String[]{"Image", "File Path", "Status", "File SHA-256 (computed)", "Reference SHA-256 (report)"}, 0) {
            @Override public boolean isCellEditable(int r, int c) { return false; }
        };
        JTable integrityTable = new JTable(integrityModel);
        integrityTable.setAutoCreateRowSorter(false);
        integrityTable.getColumnModel().getColumn(0).setPreferredWidth(120);
        integrityTable.getColumnModel().getColumn(1).setPreferredWidth(200);
        integrityTable.getColumnModel().getColumn(2).setPreferredWidth(260);
        integrityTable.getColumnModel().getColumn(3).setPreferredWidth(300);
        integrityTable.getColumnModel().getColumn(4).setPreferredWidth(300);
        tabs.addTab("Image Integrity", new JScrollPane(integrityTable));

        // Tab 3: Upload Status (Phase 5 S5.2 / S5.3) — mirrors upload_receipt.json / UploadSnapshot
        JPanel uploadPanel = new JPanel(new BorderLayout(0, 4));
        JPanel uploadNorth = new JPanel();
        uploadNorth.setLayout(new BoxLayout(uploadNorth, BoxLayout.Y_AXIS));
        uploadEmptyLabel = new JLabel(" ");
        uploadEmptyLabel.setFont(uploadEmptyLabel.getFont().deriveFont(Font.ITALIC, 12f));
        uploadEmptyLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
        uploadNorth.add(uploadEmptyLabel);
        uploadBannerLabel = new JLabel(" ");
        uploadBannerLabel.setFont(uploadBannerLabel.getFont().deriveFont(Font.BOLD, 12f));
        uploadBannerLabel.setForeground(new Color(0xC0, 0x00, 0x00));
        uploadBannerLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
        uploadBannerLabel.setVisible(false);
        uploadNorth.add(uploadBannerLabel);
        uploadPanel.add(uploadNorth, BorderLayout.NORTH);
        uploadModel =
                new DefaultTableModel(new String[] {"Field", "Value"}, 0) {
                    @Override
                    public boolean isCellEditable(int r, int c) {
                        return false;
                    }
                };
        uploadTable = new JTable(uploadModel);
        uploadTable.setAutoCreateRowSorter(false);
        // Full-width values (hashes): no column squeeze; horizontal scroll + cell copy (Ctrl+C)
        uploadTable.setAutoResizeMode(JTable.AUTO_RESIZE_OFF);
        uploadTable.setCellSelectionEnabled(true);
        uploadTable.setRowSelectionAllowed(false);
        uploadTable.setColumnSelectionAllowed(false);
        uploadTable.getTableHeader().setReorderingAllowed(false);
        uploadTable.getColumnModel().getColumn(0).setPreferredWidth(200);
        uploadTable.getColumnModel().getColumn(0).setMinWidth(120);
        uploadTable.getColumnModel().getColumn(1).setPreferredWidth(900);
        uploadTable.getColumnModel().getColumn(1).setMinWidth(400);
        ValueCellRenderer uploadValueRenderer = new ValueCellRenderer();
        uploadTable.getColumnModel().getColumn(1).setCellRenderer(uploadValueRenderer);
        uploadScroll = new JScrollPane(uploadTable);
        uploadScroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED);
        uploadScroll.setVerticalScrollBarPolicy(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED);
        uploadPanel.add(uploadScroll, BorderLayout.CENTER);
        tabs.addTab(
                NbBundle.getMessage(CaseDataExtractMonitorTopComponent.class, "Monitor.uploadTab.title"),
                uploadPanel);

        add(tabs, BorderLayout.CENTER);
        associateLookup(Lookups.singleton(this));
    }

    private void startRefreshTimer() {
        if (refreshRunning) return;
        refreshRunning = true;
        refreshThread = new Thread(() -> {
            while (refreshRunning) {
                try {
                    Thread.sleep(REFRESH_INTERVAL_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
                refresh();
            }
        }, "CaseDataExtract-MonitorRefresh");
        refreshThread.setDaemon(true);
        refreshThread.start();
    }

    private void stopRefreshTimer() {
        refreshRunning = false;
    }

    @Override
    protected void componentOpened() {
        super.componentOpened();
        startRefreshTimer();
        refresh();
    }

    @Override
    protected void componentClosed() {
        stopRefreshTimer();
        super.componentClosed();
    }

    private void refresh() {
        CaseEventRecorder rec = CaseEventRecorder.getInstance();
        boolean running = rec.isRunningNormal();
        String err = rec.getLastError();
        long lastWrite = rec.getLastWriteTimeMs();
        boolean hasCase = rec.hasOpenCase();
        int count = rec.getEventCount();
        String caseDir = rec.getCurrentCaseDirectory();

        String statusText = "Status: " + (running ? "OK" : "Error");
        if (err != null && !err.isEmpty()) statusText += " — " + err;
        if (!hasCase) statusText += " (no case open)";

        String captureText = "Capture: ";
        if (!hasCase) {
            captureText += "Waiting — please open a case first";
        } else if (count == 0 && lastWrite == 0) {
            captureText += "No data yet";
        } else {
            captureText += "Active";
            if (lastWrite > 0) captureText += ", last written " + formatTime(lastWrite);
        }

        String summaryText = "Summary: " + count + " operation(s) recorded";
        if (caseDir != null && !caseDir.isEmpty()) summaryText += " | Case dir: " + caseDir;

        List<CaseEventRecorder.OperationEntry> recent = rec.getRecentEvents(50);
        List<CaseEventRecorder.ImageIntegrityResult> integrity = rec.getIntegrityResults();
        UploadSnapshot uploadSnap = rec.getLastUpload();

        final String fs = statusText, fc = captureText, fsum = summaryText;
        final List<CaseEventRecorder.OperationEntry> opsList = recent;
        final List<CaseEventRecorder.ImageIntegrityResult> intList = integrity;
        final UploadSnapshot uploadFinal = uploadSnap;
        final boolean hasCaseFinal = hasCase;

        SwingUtilities.invokeLater(() -> {
            statusLabel.setText(fs);
            captureLabel.setText(fc);
            summaryLabel.setText(fsum);

            // Update operations table
            tableModel.setRowCount(0);
            for (CaseEventRecorder.OperationEntry e : opsList) {
                tableModel.addRow(new Object[]{
                    e.getTimeFormatted(), e.getOperationType(),
                    e.getOperator(), e.getDetail()
                });
            }

            // Update integrity table
            integrityModel.setRowCount(0);
            if (intList.isEmpty()) {
                integrityModel.addRow(new Object[]{
                    "—", "—",
                    hasCase ? "Waiting for image data sources..." : "No case open",
                    "", ""
                });
            } else {
                for (CaseEventRecorder.ImageIntegrityResult r : intList) {
                    String pathStr = r.imagePaths.length > 0 ? r.imagePaths[0] : "";
                    integrityModel.addRow(new Object[]{
                        r.imageName,
                        pathStr,
                        r.status,
                        r.fileSha256.isEmpty() ? "(computing…)" : r.fileSha256,
                        r.reportSha256.isEmpty()
                            ? (r.dbSha256.isEmpty() ? "(none)" : r.dbSha256 + " [DB]")
                            : r.reportSha256
                    });
                }
            }

            refreshUploadTab(uploadFinal, hasCaseFinal);
        });
    }

    private void refreshUploadTab(UploadSnapshot u, boolean hasCase) {
        uploadBannerLabel.setVisible(false);
        uploadBannerLabel.setText(" ");
        if (!hasCase) {
            uploadEmptyLabel.setText(
                    NbBundle.getMessage(CaseDataExtractMonitorTopComponent.class, "Monitor.upload.noCase"));
            uploadEmptyLabel.setVisible(true);
            uploadScroll.setVisible(false);
            uploadModel.setRowCount(0);
            return;
        }
        if (u == null) {
            uploadEmptyLabel.setText(
                    NbBundle.getMessage(CaseDataExtractMonitorTopComponent.class, "Monitor.upload.empty"));
            uploadEmptyLabel.setVisible(true);
            uploadScroll.setVisible(false);
            uploadModel.setRowCount(0);
            return;
        }
        uploadEmptyLabel.setVisible(false);
        uploadScroll.setVisible(true);
        if (uploadFailed(u) && isGatewayUnreachableKind(u.getErrorKind())) {
            uploadBannerLabel.setText(
                    NbBundle.getMessage(CaseDataExtractMonitorTopComponent.class, "Monitor.upload.banner.unreachable"));
            uploadBannerLabel.setVisible(true);
        }
        uploadModel.setRowCount(0);
        for (String[] row : buildUploadRows(u)) {
            uploadModel.addRow(row);
        }
        resizeUploadValueColumn();
    }

    /** Value column wide enough for full hex strings; cap to keep UI bounded. */
    private void resizeUploadValueColumn() {
        int maxChars = 8;
        for (int r = 0; r < uploadModel.getRowCount(); r++) {
            Object v = uploadModel.getValueAt(r, 1);
            if (v != null) {
                maxChars = Math.max(maxChars, v.toString().length());
            }
        }
        int w = Math.min(2000, Math.max(400, maxChars * 8 + 40));
        uploadTable.getColumnModel().getColumn(1).setPreferredWidth(w);
    }

    /** Phase 5 S5.3: error detail rows only for failed uploads (not success / cancelled / skipped). */
    private static boolean uploadFailed(UploadSnapshot u) {
        return u != null && "failed".equalsIgnoreCase(u.getStatus());
    }

    private static boolean isGatewayUnreachableKind(String errorKind) {
        return errorKind != null && "GATEWAY_UNREACHABLE".equalsIgnoreCase(errorKind.trim());
    }

    private static List<String[]> buildUploadRows(UploadSnapshot u) {
        List<String[]> rows = new ArrayList<>(24);
        rows.add(new String[] {"Status", nz(u.getStatus())});
        rows.add(new String[] {"Case ID", nz(u.getCaseId())});
        rows.add(new String[] {"Upload started (UTC)", fmtInstant(u.getUploadStartedAt())});
        rows.add(new String[] {"Upload response (UTC)", fmtInstant(u.getUploadResponseAt())});
        rows.add(new String[] {"Client round-trip (ms)", String.valueOf(u.getClientRoundTripMs())});
        rows.add(new String[] {"Request ID", naOrString(u.getRequestId())});
        UploadSnapshot.Timing t = u.getTiming();
        boolean timingNa = isTimingEmpty(t);
        rows.add(
                new String[] {
                    "Timing — integrity (ms)", timingNa ? "N/A" : String.valueOf(t.getIntegrityMs())
                });
        rows.add(new String[] {"Timing — chain (ms)", timingNa ? "N/A" : String.valueOf(t.getChainMs())});
        rows.add(new String[] {"Timing — total (ms)", timingNa ? "N/A" : String.valueOf(t.getTotalMs())});
        rows.add(
                new String[] {
                    "Timing — CaseRegistry (ms)",
                    timingNa || !t.hasCaseRegistryMs() ? "N/A" : String.valueOf(t.getCaseRegistryMs())
                });
        rows.add(new String[] {"Block timestamp (UTC)", naOrString(u.getBlockTimestampUtc())});
        rows.add(new String[] {"Index hash", naOrString(u.getIndexHash())});
        rows.add(new String[] {"Record hash", naOrString(u.getRecordHash())});
        rows.add(new String[] {"Table tx hash", naOrString(u.getTxHash())});
        rows.add(new String[] {"Block number", naOrLong(u.getBlockNumber())});
        rows.add(new String[] {"CaseRegistry tx hash", naOrString(u.getCaseRegistryTxHash())});
        rows.add(new String[] {"CaseRegistry block number", naOrLong(u.getCaseRegistryBlockNumber())});
        if (uploadFailed(u)) {
            rows.add(new String[] {"Error kind", naOrString(u.getErrorKind())});
            rows.add(new String[] {"Error message", naOrString(u.getErrorMessage())});
            rows.add(
                    new String[] {
                        "HTTP status", u.getHttpStatus() == 0 ? "N/A" : String.valueOf(u.getHttpStatus())
                    });
        }
        return rows;
    }

    private static boolean isTimingEmpty(UploadSnapshot.Timing t) {
        return t.getIntegrityMs() == 0
                && t.getChainMs() == 0
                && t.getTotalMs() == 0
                && !t.hasCaseRegistryMs();
    }

    private static String fmtInstant(Instant i) {
        if (i == null) {
            return "N/A";
        }
        return DateTimeFormatter.ISO_INSTANT.format(i);
    }

    private static String nz(String s) {
        return s == null || s.isEmpty() ? "N/A" : s;
    }

    private static String naOrString(String s) {
        return s == null || s.isEmpty() ? "N/A" : s;
    }

    private static String naOrLong(Long n) {
        return n == null ? "N/A" : String.valueOf(n);
    }

    /** Full value on one line; monospace for hex hashes (copy via cell select + Ctrl+C). */
    private static final class ValueCellRenderer extends DefaultTableCellRenderer {

        @Override
        public Component getTableCellRendererComponent(
                JTable table, Object value, boolean isSelected, boolean hasFocus, int row, int column) {
            super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
            String full = value == null ? "" : value.toString();
            setText(full);
            setToolTipText(null);
            Font base = table.getFont();
            if (full.startsWith("0x") && full.length() > 2) {
                setFont(new Font(Font.MONOSPACED, Font.PLAIN, base.getSize()));
            } else {
                setFont(base);
            }
            return this;
        }
    }

    private static String formatTime(long timeMs) {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date(timeMs));
    }
}
