package org.sleuthkit.autopsy.report.caseextract;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Font;
import java.util.List;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTabbedPane;
import javax.swing.SwingUtilities;
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

        final String fs = statusText, fc = captureText, fsum = summaryText;
        final List<CaseEventRecorder.OperationEntry> opsList = recent;
        final List<CaseEventRecorder.ImageIntegrityResult> intList = integrity;

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
        });
    }

    private static String formatTime(long timeMs) {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date(timeMs));
    }
}
