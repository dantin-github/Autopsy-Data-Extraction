package org.sleuthkit.autopsy.report.caseextract;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.logging.Level;
import java.util.logging.Logger;
import javax.swing.JPanel;
import org.openide.util.NbBundle;
import org.sleuthkit.autopsy.casemodule.Case;
import org.sleuthkit.autopsy.report.GeneralReportModule;
import org.sleuthkit.autopsy.report.ReportModuleSettings;
import org.sleuthkit.autopsy.report.ReportProgressPanel;
import org.sleuthkit.datamodel.AbstractFile;
import org.sleuthkit.datamodel.Content;
import org.sleuthkit.datamodel.Image;
import org.sleuthkit.datamodel.SleuthkitCase;
import org.sleuthkit.datamodel.TskCoreException;
import org.sleuthkit.datamodel.TskData;

/**
 * Case Data Extract Report Module: outputs case ID, examiner, operation log,
 * source file hashes, case file hashes, and an aggregate hash.
 */
@org.openide.util.lookup.ServiceProvider(service = GeneralReportModule.class)
@org.openide.util.NbBundle.Messages({
    "ReportModule.name=Case Data Extract Report",
    "ReportModule.description=Extracts case ID, examiner, operation log, source file hashes, case file hashes, and aggregate hash. Outputs a JSON report.",
    "ReportModule.status.start=Generating report...",
    "ReportModule.status.noCase=No case is currently open",
    "ReportModule.status.files=Collecting file list...",
    "ReportModule.status.filesCount=Processed {0} / {1} files",
    "ReportModule.status.done=Report generated successfully",
    "ReportModule.status.error=Failed to write report"
})
public final class CaseDataExtractReportModule implements GeneralReportModule {

    private static final Logger LOGGER = Logger.getLogger(CaseDataExtractReportModule.class.getName());
    private static final String REPORT_DIR = "CaseDataExtract";
    private static final String REPORT_FILENAME = "case_data_extract.json";
    private static final int PROGRESS_UPDATE_EVERY = 500;

    private static CaseDataExtractReportModule instance;

    private CaseDataExtractReportModuleSettings configuredSettings = new CaseDataExtractReportModuleSettings();
    private UploadSettingsPanel uploadSettingsPanel;

    public static synchronized CaseDataExtractReportModule getDefault() {
        if (instance == null) {
            instance = new CaseDataExtractReportModule();
        }
        return instance;
    }

    @Override
    public String getName() {
        return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.name");
    }

    @Override
    public String getDescription() {
        return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.description");
    }

    @Override
    public String getRelativeFilePath() {
        return REPORT_DIR + "/" + REPORT_FILENAME;
    }

    @Override
    public JPanel getConfigurationPanel() {
        if (uploadSettingsPanel == null) {
            uploadSettingsPanel = new UploadSettingsPanel();
        }
        uploadSettingsPanel.loadFrom(configuredSettings);
        return uploadSettingsPanel;
    }

    @Override
    public ReportModuleSettings getDefaultConfiguration() {
        return new CaseDataExtractReportModuleSettings();
    }

    @Override
    public ReportModuleSettings getConfiguration() {
        CaseDataExtractReportModuleSettings out = new CaseDataExtractReportModuleSettings();
        if (uploadSettingsPanel != null) {
            uploadSettingsPanel.saveTo(out);
        } else {
            configuredSettings.copyTo(out);
        }
        return out;
    }

    @Override
    public void setConfiguration(ReportModuleSettings settings) {
        if (settings instanceof CaseDataExtractReportModuleSettings s) {
            configuredSettings = s.copy();
        } else {
            configuredSettings = new CaseDataExtractReportModuleSettings();
        }
        if (uploadSettingsPanel != null) {
            uploadSettingsPanel.loadFrom(configuredSettings);
        }
    }

    @Override
    public void generateReport(String reportPath, ReportProgressPanel progressPanel) {
        progressPanel.setIndeterminate(false);
        progressPanel.updateStatusLabel(NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.start"));

        Case openCase;
        try {
            openCase = Case.getCurrentCaseThrows();
        } catch (Exception e) {
            progressPanel.updateStatusLabel(NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.noCase"));
            LOGGER.log(Level.WARNING, "No open case", e);
            return;
        }

        StringBuilder report = new StringBuilder();
        report.append("{\n");

        // 1. Case metadata
        String caseNumber = openCase.getNumber() != null ? openCase.getNumber() : "";
        String examiner = openCase.getExaminer() != null ? openCase.getExaminer() : "";
        String createdDate = openCase.getCreatedDate() != null ? openCase.getCreatedDate() : "";
        String caseName = openCase.getDisplayName() != null ? openCase.getDisplayName() : "";

        report.append("  \"caseId\": \"").append(escapeJson(caseNumber)).append("\",\n");
        report.append("  \"caseDisplayName\": \"").append(escapeJson(caseName)).append("\",\n");
        report.append("  \"examiner\": \"").append(escapeJson(examiner)).append("\",\n");
        report.append("  \"createdDate\": \"").append(escapeJson(createdDate)).append("\",\n");

        // 2. Operation log
        String caseDir = openCase.getCaseDirectory();
        List<CaseEventRecorder.OperationEntry> events = caseDir != null
                ? CaseEventRecorder.loadEventsFromCaseDirectory(caseDir)
                : CaseEventRecorder.getInstance().getAllEvents();
        report.append("  \"operations\": [\n");
        for (int i = 0; i < events.size(); i++) {
            CaseEventRecorder.OperationEntry e = events.get(i);
            if (i > 0) report.append(",\n");
            report.append("    {\"time\": \"").append(e.getTimeFormatted()).append("\", ")
                    .append("\"action\": \"").append(escapeJson(e.getOperationType())).append("\", ")
                    .append("\"operator\": \"").append(escapeJson(e.getOperator())).append("\", ")
                    .append("\"detail\": \"").append(escapeJson(e.getDetail())).append("\"}");
        }
        report.append("\n  ],\n");

        // 3. Data sources (source file paths and hashes)
        report.append("  \"dataSources\": [\n");
        List<Content> dataSources;
        try {
            dataSources = openCase.getDataSources();
        } catch (TskCoreException e) {
            dataSources = new ArrayList<>();
            LOGGER.log(Level.WARNING, "getDataSources failed", e);
        }
        for (int i = 0; i < dataSources.size(); i++) {
            if (i > 0) report.append(",\n");
            Content ds = dataSources.get(i);
            report.append("    {\"name\": \"").append(escapeJson(ds.getName())).append("\", ");
            if (ds instanceof Image) {
                Image img = (Image) ds;
                String[] paths = img.getPaths();
                StringBuilder pathStr = new StringBuilder("[");
                if (paths != null) {
                    for (int p = 0; p < paths.length; p++) {
                        if (p > 0) pathStr.append(", ");
                        pathStr.append("\"").append(escapeJson(paths[p])).append("\"");
                    }
                }
                pathStr.append("]");
                report.append("\"paths\": ").append(pathStr).append(", ");
                try {
                    String md5 = img.getMd5();
                    String sha256 = img.getSha256();
                    report.append("\"md5\": \"").append(md5 != null ? escapeJson(md5) : "").append("\", ");
                    report.append("\"sha256\": \"").append(sha256 != null ? escapeJson(sha256) : "").append("\"}");
                } catch (TskCoreException e) {
                    report.append("\"md5\": \"\", \"sha256\": \"\"}");
                }
            } else {
                report.append("\"paths\": [], \"md5\": \"\", \"sha256\": \"\"}");
            }
        }
        report.append("\n  ],\n");

        // 4. All files inside the image (deleted + undeleted), with full metadata
        report.append("  \"files\": [\n");
        SleuthkitCase skCase = openCase.getSleuthkitCase();
        List<AbstractFile> allFiles = new ArrayList<>();
        try {
            // Query the Sleuthkit database directly — this reliably includes deleted files
            allFiles = skCase.findAllFilesWhere("1=1");
        } catch (TskCoreException e) {
            LOGGER.log(Level.WARNING, "findAllFilesWhere failed, falling back to tree traversal", e);
            try {
                collectFiles(dataSources, skCase, allFiles);
            } catch (TskCoreException e2) {
                LOGGER.log(Level.WARNING, "collectFiles fallback also failed", e2);
            }
        }
        int total = allFiles.size();
        progressPanel.setMaximumProgress(Math.max(total, 1));
        progressPanel.updateStatusLabel(NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.files"));
        int written = 0;
        for (int i = 0; i < allFiles.size(); i++) {
            if (progressPanel.getStatus() == ReportProgressPanel.ReportStatus.CANCELED) {
                progressPanel.cancel();
                report.append("\n  ],\n  \"cancelled\": true,\n  \"aggregateHash\": \"\",\n  \"aggregateHashNote\": \"cancelled\"\n}\n");
                try {
                    java.nio.file.Path outDir2 = java.nio.file.Paths.get(reportPath, REPORT_DIR);
                    Files.createDirectories(outDir2);
                    try (BufferedWriter w = Files.newBufferedWriter(outDir2.resolve(REPORT_FILENAME), StandardCharsets.UTF_8)) {
                        w.write(report.toString());
                    }
                } catch (IOException ignored) {}
                return;
            }
            if (i > 0) report.append(",\n");
            AbstractFile f = allFiles.get(i);

            String name = f.getName() != null ? f.getName() : "";
            String path = "";
            try { path = f.getUniquePath() != null ? f.getUniquePath() : ""; } catch (TskCoreException ignored) {}
            long size = f.getSize();
            String created  = formatTimestamp(f.getCrtime());
            String modified = formatTimestamp(f.getMtime());
            String accessed = formatTimestamp(f.getAtime());
            String changed  = formatTimestamp(f.getCtime());
            boolean deleted   = f.isDirNameFlagSet(TskData.TSK_FS_NAME_FLAG_ENUM.UNALLOC);
            boolean allocated = f.isMetaFlagSet(TskData.TSK_FS_META_FLAG_ENUM.ALLOC);
            boolean isDir     = f.isDir();
            String known = "unknown";
            try {
                TskData.FileKnown k = f.getKnown();
                if (k != null) known = k.toString().toLowerCase(Locale.ROOT);
            } catch (Exception ignored) {}
            String mimeType = f.getMIMEType() != null ? f.getMIMEType() : "";
            String md5    = f.getMd5Hash()    != null ? f.getMd5Hash()    : "";
            String sha256 = f.getSha256Hash() != null ? f.getSha256Hash() : "";

            report.append("    {")
                    .append("\"name\": \"").append(escapeJson(name)).append("\", ")
                    .append("\"path\": \"").append(escapeJson(path)).append("\", ")
                    .append("\"size\": ").append(size).append(", ")
                    .append("\"created\": \"").append(created).append("\", ")
                    .append("\"modified\": \"").append(modified).append("\", ")
                    .append("\"accessed\": \"").append(accessed).append("\", ")
                    .append("\"changed\": \"").append(changed).append("\", ")
                    .append("\"isDir\": ").append(isDir).append(", ")
                    .append("\"deleted\": ").append(deleted).append(", ")
                    .append("\"allocated\": ").append(allocated).append(", ")
                    .append("\"known\": \"").append(escapeJson(known)).append("\", ")
                    .append("\"mimeType\": \"").append(escapeJson(mimeType)).append("\", ")
                    .append("\"md5\": \"").append(escapeJson(md5)).append("\", ")
                    .append("\"sha256\": \"").append(escapeJson(sha256)).append("\"}");

            written++;
            if (written % PROGRESS_UPDATE_EVERY == 0) {
                progressPanel.setProgress(written);
                progressPanel.updateStatusLabel(NbBundle.getMessage(CaseDataExtractReportModule.class,
                        "ReportModule.status.filesCount", written, total));
            }
        }
        report.append("\n  ],\n");

        // 5. Aggregate hash: same algorithm as api-gateway integrity.js (canonical JSON + SHA-256)
        String body = report.toString();
        String forHash = body + "  \"aggregateHash\": \"\",\n  \"aggregateHashNote\": \"\"\n}\n";
        String aggregateHash = CanonicalJson.computeAggregateHash(forHash);
        report.append("  \"aggregateHash\": \"").append(aggregateHash).append("\",\n");
        report.append("  \"aggregateHashNote\": \"SHA-256 of JSON with aggregateHash and aggregateHashNote cleared, ")
                .append("keys sorted lexicographically at every object depth, compact UTF-8 serialization (matches api-gateway integrity.js)\"\n");
        report.append("}\n");

        try {
            // reportPath is the directory Autopsy created for this module's output
            java.nio.file.Path outDir = java.nio.file.Paths.get(reportPath, REPORT_DIR);
            Files.createDirectories(outDir);
            java.nio.file.Path outPath = outDir.resolve(REPORT_FILENAME);
            try (BufferedWriter w = Files.newBufferedWriter(outPath, StandardCharsets.UTF_8)) {
                w.write(report.toString());
            }
            try {
                openCase.addReport(outPath.toAbsolutePath().toString(), getClass().getSimpleName(), getName());
            } catch (TskCoreException ex) {
                LOGGER.log(Level.WARNING, "addReport failed", ex);
            }
            progressPanel.complete(ReportProgressPanel.ReportStatus.COMPLETE, NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.done"));
        } catch (IOException e) {
            progressPanel.complete(ReportProgressPanel.ReportStatus.ERROR, NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.error"));
            LOGGER.log(Level.SEVERE, "Write report failed", e);
        }
    }

    private static void collectFiles(List<Content> dataSources, SleuthkitCase skCase, List<AbstractFile> out) throws TskCoreException {
        for (Content ds : dataSources) {
            collectFilesRecursive(ds, out);
        }
    }

    private static void collectFilesRecursive(Content content, List<AbstractFile> out) throws TskCoreException {
        if (content instanceof AbstractFile) {
            out.add((AbstractFile) content);
            return;
        }
        for (Content child : content.getChildren()) {
            collectFilesRecursive(child, out);
        }
    }

    private static final DateTimeFormatter TS_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.systemDefault());

    /** Formats a Unix epoch-seconds timestamp; returns "" for zero/negative values. */
    private static String formatTimestamp(long epochSeconds) {
        if (epochSeconds <= 0) return "";
        return TS_FMT.format(Instant.ofEpochSecond(epochSeconds));
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

}
