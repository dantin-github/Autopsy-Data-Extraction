package org.sleuthkit.autopsy.report.caseextract;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
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
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayClient;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayUploadException;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayError;
import org.sleuthkit.autopsy.report.caseextract.gateway.ProposalResponse;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadClientTiming;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadRequest;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadResponse;

/**
 * Case Data Extract Report Module: outputs case ID, examiner, operation log,
 * source file hashes, case file hashes, and an aggregate hash.
 * Phase 4 S4.1: optional {@code POST /api/upload} after the JSON file is saved when upload is enabled in settings.
 * Phase 4 S4.2: operator-facing upload outcome (table + CaseRegistry tx, error hints, optional {@code X-Debug-Timing}).
 * Phase 4 S4.3: {@code upload_receipt.json} beside the report with client RTT and gateway {@code requestId} / {@code timing} /
 * {@code blockTimestampUtc} when present.
 * Phase 4 S4.4: append {@code uploadStatus} / {@code uploadDetail} to {@code case_data_extract.json} after upload outcome;
 * {@link CanonicalJson} and api-gateway {@code integrity.js} ignore these keys for {@code aggregateHash}.
 * Phase 4 S4.5: during upload, status text {@code Uploading to blockchain…}; cancel disconnects {@link HttpURLConnection}
 * and writes receipt / main JSON {@code uploadStatus} {@code cancelled}.
 * Phase 4 S4.6: {@link CaseEventRecorder#addEvent} {@code UPLOAD_OK} / {@code UPLOAD_FAILED} with English audit detail; gateway
 * failures log {@link Level#WARNING} with operator-facing summary per {@link GatewayUploadException.Kind}.
 * Phase 4 S4.7: {@link UploadClientTiming} inside {@link GatewayClient} defines receipt {@code uploadStartedAt} /
 * {@code uploadResponseAt} / {@code clientRoundTripMs} for §5.4.
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
    "ReportModule.status.error=Failed to write report",
    "ReportModule.status.uploading=Uploading report to gateway...",
    "ReportModule.status.uploadingBlockchain=Uploading to blockchain\u2026",
    "ReportModule.status.uploadCancelled=Report generated; local report saved; gateway upload was cancelled.",
    "ReportModule.status.uploadOk=Report generated; gateway upload completed (table tx: {0}).",
    "ReportModule.status.uploadOkBoth=Report generated; gateway upload completed (table tx: {0}, CaseRegistry tx: {1}).",
    "ReportModule.status.uploadFailed=Report generated; gateway upload failed: {0}",
    "ReportModule.status.uploadSkippedBadUrl=Report generated; gateway upload skipped (invalid gateway URL).",
    "ReportModule.status.uploadSkippedNoToken=Report generated; gateway upload skipped (token is required).",
    "ReportModule.status.uploadSkippedNoCaseId=Report generated; gateway upload skipped (case number is empty).",
    "ReportModule.status.uploadTimingPartial=Timing: {0} ms total (integrity {1} ms, chain {2} ms).",
    "ReportModule.status.uploadTimingFull=Timing: {0} ms total (integrity {1} ms, chain {2} ms, CaseRegistry {3} ms).",
    "ReportModule.uploadErr.tokenExpired=Token expired; request a new OTP from the gateway.",
    "ReportModule.uploadErr.tokenConsumed=Token already used; request a new OTP.",
    "ReportModule.uploadErr.duplicate=Case is already on CaseRegistry; use modify workflow or a different case number.",
    "ReportModule.uploadErr.payloadTooLarge=Request too large for the gateway; increase JSON_BODY_LIMIT and restart the API server.",
    "ReportModule.uploadErr.timeout=Gateway connection timed out.",
    "ReportModule.uploadErr.unreachable=Gateway unreachable.",
    "ReportModule.uploadErr.chainUnavailable=Blockchain service unavailable (503).",
    "ReportModule.uploadErr.forbidden=Not allowed (check police account and signing password).",
    "ReportModule.uploadErr.aggregate=Aggregate hash verification failed.",
    "ReportModule.uploadErr.signing=Signing password missing or incorrect for contract upload.",
    "ReportModule.uploadErr.http=HTTP {0}: {1}",
    "ReportModule.uploadErr.cancelled=Upload cancelled.",
    "ReportModule.status.proposing=Submitting modification proposal to gateway...",
    "ReportModule.status.proposeOk=Report generated; modification proposal submitted (proposalId: {0}).",
    "ReportModule.status.proposeFailed=Report generated; modification proposal failed: {0}",
    "ReportModule.status.proposeSkippedNoSigning=Report generated; modification proposal skipped (signing password is required).",
    "ReportModule.status.proposeSkippedNoReason=Report generated; modification proposal skipped (reason is required).",
    "ReportModule.status.uploadHintExists=Case already exists on chain; uncheck \"Upload after save\" and check \"Submit as modification proposal\" instead.",
    "ReportModule.proposeErr.oldHashMismatch=Local record does not match the chain; refresh or re-upload before proposing."
})
public final class CaseDataExtractReportModule implements GeneralReportModule {

    private static final Logger LOGGER = Logger.getLogger(CaseDataExtractReportModule.class.getName());
    private static final String REPORT_DIR = "CaseDataExtract";
    private static final String REPORT_FILENAME = "case_data_extract.json";
    private static final int PROGRESS_UPDATE_EVERY = 500;

    /** Same rule as {@link UploadSettingsPanel} (Phase 3 S3.4). */
    private static final Pattern GATEWAY_BASE_URL_PATTERN =
            Pattern.compile("^https?://[\\w.\\-]+(:\\d+)?(/.*)?$");

    private static CaseDataExtractReportModule instance;

    private CaseDataExtractReportModuleSettings configuredSettings = new CaseDataExtractReportModuleSettings();
    private UploadSettingsPanel uploadSettingsPanel;

    public CaseDataExtractReportModule() {
        CaseDataExtractUploadPreferences.applyTo(configuredSettings);
    }

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
        CaseDataExtractUploadPreferences.saveFrom(out);
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

        String reportJson = report.toString();
        CaseDataExtractReportModuleSettings runSettings = effectiveSettingsForRun();

        try {
            // reportPath is the directory Autopsy created for this module's output
            java.nio.file.Path outDir = java.nio.file.Paths.get(reportPath, REPORT_DIR);
            Files.createDirectories(outDir);
            java.nio.file.Path outPath = outDir.resolve(REPORT_FILENAME);
            try (BufferedWriter w = Files.newBufferedWriter(outPath, StandardCharsets.UTF_8)) {
                w.write(reportJson);
            }
            try {
                openCase.addReport(outPath.toAbsolutePath().toString(), getClass().getSimpleName(), getName());
            } catch (TskCoreException ex) {
                LOGGER.log(Level.WARNING, "addReport failed", ex);
            }

            String completion =
                    NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.done");
            if (runSettings.isProposalEnabled()) {
                progressPanel.updateStatusLabel(
                        NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.proposing"));
                String proposeMsg =
                        maybeProposeReportJson(
                                outPath,
                                outDir,
                                runSettings,
                                reportJson,
                                caseNumber,
                                examiner,
                                aggregateHash);
                if (proposeMsg != null) {
                    completion = proposeMsg;
                }
            } else if (runSettings.isUploadEnabled()) {
                progressPanel.updateStatusLabel(
                        NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadingBlockchain"));
                String uploadMsg =
                        maybeUploadReportJson(
                                outPath,
                                outDir,
                                progressPanel,
                                runSettings,
                                reportJson,
                                caseNumber,
                                examiner,
                                aggregateHash);
                if (uploadMsg != null) {
                    completion = uploadMsg;
                }
            }
            progressPanel.complete(ReportProgressPanel.ReportStatus.COMPLETE, completion);
        } catch (IOException e) {
            progressPanel.complete(ReportProgressPanel.ReportStatus.ERROR, NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.error"));
            LOGGER.log(Level.SEVERE, "Write report failed", e);
        }
    }

    private CaseDataExtractReportModuleSettings effectiveSettingsForRun() {
        CaseDataExtractReportModuleSettings s = new CaseDataExtractReportModuleSettings();
        if (uploadSettingsPanel != null) {
            uploadSettingsPanel.saveTo(s);
        } else {
            configuredSettings.copyTo(s);
        }
        return s;
    }

    /**
     * P3: POST /api/modify/propose-with-token after {@code case_data_extract.json} is written.
     *
     * @return user-facing completion line when proposal was attempted or skipped; {@code null} if proposal is disabled
     */
    private String maybeProposeReportJson(
            java.nio.file.Path caseJsonPath,
            java.nio.file.Path reportOutputDir,
            CaseDataExtractReportModuleSettings cfg,
            String reportJson,
            String caseId,
            String examiner,
            String aggregateHash) {
        if (!cfg.isProposalEnabled()) {
            return null;
        }
        String base = cfg.getGatewayUrl() != null ? cfg.getGatewayUrl().trim() : "";
        if (base.isEmpty() || !GATEWAY_BASE_URL_PATTERN.matcher(base).matches()) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedBadUrl");
        }
        String token = cfg.getOneTimeToken() != null ? cfg.getOneTimeToken().trim() : "";
        if (token.isEmpty()) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedNoToken");
        }
        if (caseId == null || caseId.isBlank()) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedNoCaseId");
        }
        String signing = cfg.getSigningPassword();
        if (signing == null || signing.isBlank()) {
            return NbBundle.getMessage(
                    CaseDataExtractReportModule.class, "ReportModule.status.proposeSkippedNoSigning");
        }
        String reason = cfg.getProposalReason() != null ? cfg.getProposalReason().trim() : "";
        if (reason.isEmpty()) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.proposeSkippedNoReason");
        }
        String generatedAt =
                DateTimeFormatter.ISO_INSTANT.format(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        UploadRequest req =
                new UploadRequest(
                        caseId.trim(),
                        examiner != null ? examiner.trim() : "",
                        aggregateHash,
                        generatedAt,
                        reportJson);
        UploadClientTiming clientTiming = new UploadClientTiming();
        try {
            ProposalResponse resp =
                    new GatewayClient()
                            .proposeModification(base, req, token, signing, reason, clientTiming);
            Instant started = clientTiming.getUploadStartedAt();
            Instant ended = clientTiming.getUploadResponseAt();
            long rtt = clientTiming.getClientRoundTripMs();
            try {
                ProposalReceiptWriter.writeSuccess(reportOutputDir, started, ended, rtt, resp);
            } catch (IOException ioe) {
                LOGGER.log(Level.WARNING, "Could not write proposal_receipt.json", ioe);
            }
            LOGGER.log(
                    Level.INFO,
                    "Gateway propose succeeded caseId={0} proposalId={1} tx={2} clientRoundTripMs={3}",
                    new Object[] {caseId, resp.getProposalId(), resp.getTxHash(), rtt});
            return NbBundle.getMessage(
                    CaseDataExtractReportModule.class, "ReportModule.status.proposeOk", resp.getProposalId());
        } catch (GatewayUploadException e) {
            Instant started = clientTiming.getUploadStartedAt();
            Instant ended = clientTiming.getUploadResponseAt();
            long rtt = clientTiming.getClientRoundTripMs();
            try {
                ProposalReceiptWriter.writeFailure(reportOutputDir, started, ended, rtt, e);
            } catch (IOException ioe) {
                LOGGER.log(Level.WARNING, "Could not write proposal_receipt.json", ioe);
            }
            String detail = summarizeProposalFailure(e);
            LOGGER.log(
                    Level.WARNING,
                    "Gateway propose failed caseId={0} kind={1}: {2}",
                    new Object[] {caseId, e.getKind(), detail});
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.proposeFailed", detail);
        }
    }

    private static String summarizeProposalFailure(GatewayUploadException e) {
        String raw = e.getMessage() != null ? e.getMessage() : "";
        String lower = raw.toLowerCase(Locale.ROOT);
        if (e.getKind() == GatewayUploadException.Kind.DUPLICATE
                && (lower.contains("old") && lower.contains("hash") || lower.contains("old_hash_mismatch"))) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.proposeErr.oldHashMismatch");
        }
        return summarizeGatewayUploadFailure(e);
    }

    /**
     * Phase 4 S4.1–S4.5: POST /api/upload with police OTP after the JSON file is written; format outcome for the operator;
     * write {@link UploadReceiptWriter#RECEIPT_FILENAME} on HTTP success, failure, or cancel; patch {@code case_data_extract.json} with
     * {@code uploadStatus} / {@code uploadDetail} when upload is enabled.
     *
     * @return a user-facing completion line when upload was attempted or skipped due to validation; {@code null} if
     *     upload is disabled
     */
    private String maybeUploadReportJson(
            java.nio.file.Path caseJsonPath,
            java.nio.file.Path reportOutputDir,
            ReportProgressPanel progressPanel,
            CaseDataExtractReportModuleSettings cfg,
            String reportJson,
            String caseId,
            String examiner,
            String aggregateHash) {
        if (!cfg.isUploadEnabled()) {
            return null;
        }
        String base = cfg.getGatewayUrl() != null ? cfg.getGatewayUrl().trim() : "";
        if (base.isEmpty() || !GATEWAY_BASE_URL_PATTERN.matcher(base).matches()) {
            try {
                ReportUploadStatusPatcher.patchSkipped(caseJsonPath, "invalid_gateway_url");
            } catch (IOException ioe) {
                LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload skipped)", ioe);
            }
            CaseEventRecorder.getInstance()
                    .setLastUpload(UploadSnapshot.fromSkipped(caseId, "invalid_gateway_url"));
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedBadUrl");
        }
        String token = cfg.getOneTimeToken() != null ? cfg.getOneTimeToken().trim() : "";
        if (token.isEmpty()) {
            try {
                ReportUploadStatusPatcher.patchSkipped(caseJsonPath, "missing_token");
            } catch (IOException ioe) {
                LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload skipped)", ioe);
            }
            CaseEventRecorder.getInstance()
                    .setLastUpload(UploadSnapshot.fromSkipped(caseId, "missing_token"));
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedNoToken");
        }
        if (caseId == null || caseId.isBlank()) {
            try {
                ReportUploadStatusPatcher.patchSkipped(caseJsonPath, "missing_case_id");
            } catch (IOException ioe) {
                LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload skipped)", ioe);
            }
            CaseEventRecorder.getInstance()
                    .setLastUpload(UploadSnapshot.fromSkipped("", "missing_case_id"));
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadSkippedNoCaseId");
        }
        String generatedAt =
                DateTimeFormatter.ISO_INSTANT.format(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        UploadRequest req =
                new UploadRequest(
                        caseId.trim(),
                        examiner != null ? examiner.trim() : "",
                        aggregateHash,
                        generatedAt,
                        reportJson);
        String signing = cfg.getSigningPassword();
        boolean timing = cfg.isUploadRequestTiming();
        AtomicReference<HttpURLConnection> connRef = new AtomicReference<>();
        AtomicBoolean stopWatcher = new AtomicBoolean(false);
        Thread cancelWatcher =
                new Thread(
                        () -> {
                            while (!stopWatcher.get()) {
                                try {
                                    if (progressPanel.getStatus()
                                            == ReportProgressPanel.ReportStatus.CANCELED) {
                                        HttpURLConnection x = connRef.get();
                                        if (x != null) {
                                            x.disconnect();
                                        }
                                        return;
                                    }
                                    Thread.sleep(120);
                                } catch (InterruptedException ie) {
                                    Thread.currentThread().interrupt();
                                    return;
                                }
                            }
                        },
                        "caseextract-upload-cancel-watch");
        cancelWatcher.setDaemon(true);
        cancelWatcher.start();
        UploadClientTiming clientTiming = new UploadClientTiming();
        try {
            try {
                UploadResponse resp =
                        new GatewayClient()
                                .uploadCase(
                                        base,
                                        req,
                                        token,
                                        signing,
                                        timing,
                                        connRef,
                                        () ->
                                                progressPanel.getStatus()
                                                        == ReportProgressPanel.ReportStatus.CANCELED,
                                        clientTiming);
                Instant uploadStartedAt = clientTiming.getUploadStartedAt();
                Instant uploadResponseAt = clientTiming.getUploadResponseAt();
                long clientRoundTripMs = clientTiming.getClientRoundTripMs();
                try {
                    UploadReceiptWriter.writeSuccess(
                            reportOutputDir, uploadStartedAt, uploadResponseAt, clientRoundTripMs, resp);
                } catch (IOException ioe) {
                    LOGGER.log(Level.WARNING, "Could not write upload_receipt.json", ioe);
                }
                try {
                    ReportUploadStatusPatcher.patchSuccess(caseJsonPath, resp, clientRoundTripMs);
                } catch (IOException ioe) {
                    LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload success)", ioe);
                }
                String reg = resp.getCaseRegistryTxHash();
                LOGGER.log(
                        Level.INFO,
                        "Gateway upload succeeded caseId={0} tableTx={1} registryTx={2} clientRoundTripMs={3}",
                        new Object[] {caseId, resp.getTxHash(), reg != null ? reg : "", clientRoundTripMs});
                String msg;
                if (reg != null && !reg.isBlank()) {
                    msg =
                            NbBundle.getMessage(
                                    CaseDataExtractReportModule.class,
                                    "ReportModule.status.uploadOkBoth",
                                    resp.getTxHash(),
                                    reg);
                } else {
                    msg =
                            NbBundle.getMessage(
                                    CaseDataExtractReportModule.class,
                                    "ReportModule.status.uploadOk",
                                    resp.getTxHash());
                }
                if (timing && resp.getTiming() != null) {
                    msg += " " + formatUploadTimingLine(resp.getTiming());
                }
                recordUploadOk(examiner, caseId, resp, clientRoundTripMs);
                CaseEventRecorder.getInstance()
                        .setLastUpload(
                                UploadSnapshot.fromSuccess(
                                        caseId, uploadStartedAt, uploadResponseAt, clientRoundTripMs, resp));
                return msg;
            } catch (GatewayUploadException e) {
                Instant uploadStartedAt = clientTiming.getUploadStartedAt();
                Instant uploadResponseAt = clientTiming.getUploadResponseAt();
                long clientRoundTripMs = clientTiming.getClientRoundTripMs();
                boolean userCancel =
                        progressPanel.getStatus() == ReportProgressPanel.ReportStatus.CANCELED
                                || e.getKind() == GatewayUploadException.Kind.CANCELLED;
                if (userCancel) {
                    try {
                        UploadReceiptWriter.writeCancelled(
                                reportOutputDir, uploadStartedAt, uploadResponseAt, clientRoundTripMs);
                    } catch (IOException ioe) {
                        LOGGER.log(Level.WARNING, "Could not write upload_receipt.json", ioe);
                    }
                    try {
                        ReportUploadStatusPatcher.patchCancelled(caseJsonPath, clientRoundTripMs);
                    } catch (IOException ioe) {
                        LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload cancelled)", ioe);
                    }
                    recordUploadCancelled(examiner, caseId, clientRoundTripMs);
                    CaseEventRecorder.getInstance()
                            .setLastUpload(
                                    UploadSnapshot.fromCancelled(
                                            caseId, uploadStartedAt, uploadResponseAt, clientRoundTripMs));
                    return NbBundle.getMessage(
                            CaseDataExtractReportModule.class, "ReportModule.status.uploadCancelled");
                }
                try {
                    UploadReceiptWriter.writeFailure(
                            reportOutputDir, uploadStartedAt, uploadResponseAt, clientRoundTripMs, e);
                } catch (IOException ioe) {
                    LOGGER.log(Level.WARNING, "Could not write upload_receipt.json", ioe);
                }
                try {
                    ReportUploadStatusPatcher.patchFailure(caseJsonPath, e, clientRoundTripMs);
                } catch (IOException ioe) {
                    LOGGER.log(Level.WARNING, "Could not patch case_data_extract.json (upload failed)", ioe);
                }
                recordUploadFailed(examiner, caseId, e, clientRoundTripMs);
                CaseEventRecorder.getInstance()
                        .setLastUpload(
                                UploadSnapshot.fromFailure(
                                        caseId, uploadStartedAt, uploadResponseAt, clientRoundTripMs, e));
                String detail = summarizeGatewayUploadFailure(e);
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.status.uploadFailed", detail);
            }
        } finally {
            stopWatcher.set(true);
            cancelWatcher.interrupt();
            try {
                cancelWatcher.join(2000);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static void recordUploadOk(String examiner, String caseId, UploadResponse resp, long clientRoundTripMs) {
        String ex = examiner != null ? examiner : "";
        String cid = caseId != null ? caseId : "";
        String reg = resp.getCaseRegistryTxHash();
        StringBuilder detail = new StringBuilder(180);
        detail.append("caseId=").append(cid);
        detail.append(" | tableTx=").append(resp.getTxHash());
        detail.append(" | clientRoundTripMs=").append(clientRoundTripMs);
        if (reg != null && !reg.isBlank()) {
            detail.append(" | caseRegistryTx=").append(reg);
        }
        if (resp.getRequestId() != null && !resp.getRequestId().isBlank()) {
            detail.append(" | requestId=").append(resp.getRequestId());
        }
        CaseEventRecorder.getInstance().addEvent("UPLOAD_OK", ex, detail.toString());
        LOGGER.log(Level.INFO, "CaseEventRecorder UPLOAD_OK {0}", detail.toString());
    }

    /**
     * User cancelled during upload (S4.5); plan S4.6 uses {@code UPLOAD_FAILED} with {@code errorKind=CANCELLED} in detail.
     */
    private static void recordUploadCancelled(String examiner, String caseId, long clientRoundTripMs) {
        String ex = examiner != null ? examiner : "";
        String cid = caseId != null ? caseId : "";
        String detail =
                "caseId="
                        + cid
                        + " | errorKind=CANCELLED | clientRoundTripMs="
                        + clientRoundTripMs;
        CaseEventRecorder.getInstance().addEvent("UPLOAD_FAILED", ex, detail);
        LOGGER.log(Level.INFO, "CaseEventRecorder UPLOAD_FAILED (cancelled) {0}", detail);
    }

    private static void recordUploadFailed(
            String examiner, String caseId, GatewayUploadException e, long clientRoundTripMs) {
        String ex = examiner != null ? examiner : "";
        String cid = caseId != null ? caseId : "";
        String friendly = summarizeGatewayUploadFailure(e);
        String detail =
                "caseId="
                        + cid
                        + " | errorKind="
                        + e.getKind().name()
                        + " | httpStatus="
                        + e.getHttpStatus()
                        + " | clientRoundTripMs="
                        + clientRoundTripMs
                        + " | operatorMessage="
                        + friendly;
        CaseEventRecorder.getInstance().addEvent("UPLOAD_FAILED", ex, detail);
        LOGGER.log(
                Level.WARNING,
                "Gateway upload failed caseId={0} kind={1}: {2}",
                new Object[] {cid, e.getKind(), friendly});
        LOGGER.log(Level.FINE, "Gateway upload failed stack", e);
    }

    private static String formatUploadTimingLine(UploadResponse.UploadTiming t) {
        if (t.hasCaseRegistryMs()) {
            return NbBundle.getMessage(
                    CaseDataExtractReportModule.class,
                    "ReportModule.status.uploadTimingFull",
                    t.getTotalMs(),
                    t.getIntegrityMs(),
                    t.getChainMs(),
                    t.getCaseRegistryMs());
        }
        return NbBundle.getMessage(
                CaseDataExtractReportModule.class,
                "ReportModule.status.uploadTimingPartial",
                t.getTotalMs(),
                t.getIntegrityMs(),
                t.getChainMs());
    }

    private static String summarizeGatewayUploadFailure(GatewayUploadException e) {
        String raw = e.getMessage() != null ? e.getMessage() : "";
        String lower = raw.toLowerCase(Locale.ROOT);
        if (e.getHttpStatus() == 413
                || lower.contains("entity too large")
                || (lower.contains("too large") && lower.contains("body"))) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.payloadTooLarge");
        }
        if (e.getKind() == GatewayUploadException.Kind.DUPLICATE || lower.contains("already exists")) {
            return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.duplicate");
        }
        switch (e.getKind()) {
            case CANCELLED:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.cancelled");
            case TOKEN_EXPIRED:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.tokenExpired");
            case TOKEN_CONSUMED:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.tokenConsumed");
            case TIMEOUT:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.timeout");
            case GATEWAY_UNREACHABLE:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.unreachable");
            case CHAIN_UNAVAILABLE:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.chainUnavailable");
            case FORBIDDEN:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.forbidden");
            case AGGREGATE_MISMATCH:
                return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.aggregate");
            case BAD_REQUEST:
                if (lower.contains("signingpassword") || lower.contains("signing password")) {
                    return NbBundle.getMessage(CaseDataExtractReportModule.class, "ReportModule.uploadErr.signing");
                }
                break;
            default:
                break;
        }
        GatewayError ge = e.getGatewayError();
        if (ge != null && ge.getError() != null && !ge.getError().isBlank()) {
            return ge.getError();
        }
        if (e.getHttpStatus() > 0) {
            return NbBundle.getMessage(
                    CaseDataExtractReportModule.class,
                    "ReportModule.uploadErr.http",
                    e.getHttpStatus(),
                    raw.isEmpty() ? e.getKind().name() : abbreviateOperatorMessage(raw, 220));
        }
        return abbreviateOperatorMessage(raw.isEmpty() ? e.getKind().name() : raw, 280);
    }

    private static String abbreviateOperatorMessage(String s, int max) {
        if (s.length() <= max) {
            return s;
        }
        return s.substring(0, max - 1) + "…";
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
