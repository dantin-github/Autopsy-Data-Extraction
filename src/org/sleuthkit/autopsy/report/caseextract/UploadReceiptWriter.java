package org.sleuthkit.autopsy.report.caseextract;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayUploadException;
import org.sleuthkit.autopsy.report.caseextract.gateway.JsonStrings;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadResponse;

/**
 * Phase 4 S4.3: persist gateway upload outcome next to {@code case_data_extract.json} for auditing and §5.4 latency.
 */
public final class UploadReceiptWriter {

    static final String RECEIPT_FILENAME = "upload_receipt.json";

    private static final DateTimeFormatter ISO_INST = DateTimeFormatter.ISO_INSTANT;
    private static final int MAX_ERR_LEN = 4000;

    private UploadReceiptWriter() {
    }

    static void writeSuccess(
            Path reportOutputDir,
            Instant uploadStartedAt,
            Instant uploadResponseAt,
            long clientRoundTripMs,
            UploadResponse resp)
            throws IOException {
        StringBuilder sb = new StringBuilder(640);
        sb.append("{\n");
        sb.append("  \"uploadStatus\": \"success\",\n");
        sb.append("  \"uploadStartedAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadStartedAt))).append(",\n");
        sb.append("  \"uploadResponseAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadResponseAt))).append(",\n");
        sb.append("  \"clientRoundTripMs\": ").append(clientRoundTripMs).append(",\n");
        if (resp.getRequestId() != null && !resp.getRequestId().isBlank()) {
            sb.append("  \"requestId\": ").append(JsonStrings.quote(resp.getRequestId())).append(",\n");
        }
        if (resp.getTiming() != null) {
            sb.append("  \"timing\": ");
            appendTimingInline(sb, resp.getTiming());
            sb.append(",\n");
        }
        if (resp.getBlockTimestampUtc() != null && !resp.getBlockTimestampUtc().isBlank()) {
            sb.append("  \"blockTimestampUtc\": ")
                    .append(JsonStrings.quote(resp.getBlockTimestampUtc()))
                    .append(",\n");
        }
        sb.append("  \"indexHash\": ").append(JsonStrings.quote(resp.getIndexHash())).append(",\n");
        sb.append("  \"recordHash\": ").append(JsonStrings.quote(resp.getRecordHash())).append(",\n");
        sb.append("  \"txHash\": ").append(JsonStrings.quote(resp.getTxHash())).append(",\n");
        sb.append("  \"blockNumber\": ").append(resp.getBlockNumber());
        if (resp.getCaseRegistryTxHash() != null && !resp.getCaseRegistryTxHash().isBlank()) {
            sb.append(",\n  \"caseRegistryTxHash\": ").append(JsonStrings.quote(resp.getCaseRegistryTxHash()));
        }
        if (resp.getCaseRegistryBlockNumber() != null) {
            sb.append(",\n  \"caseRegistryBlockNumber\": ").append(resp.getCaseRegistryBlockNumber());
        }
        sb.append("\n}\n");
        Files.writeString(reportOutputDir.resolve(RECEIPT_FILENAME), sb.toString(), StandardCharsets.UTF_8);
    }

    static void writeFailure(
            Path reportOutputDir,
            Instant uploadStartedAt,
            Instant uploadResponseAt,
            long clientRoundTripMs,
            GatewayUploadException e)
            throws IOException {
        StringBuilder sb = new StringBuilder(384);
        sb.append("{\n");
        sb.append("  \"uploadStatus\": \"failed\",\n");
        sb.append("  \"uploadStartedAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadStartedAt))).append(",\n");
        sb.append("  \"uploadResponseAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadResponseAt))).append(",\n");
        sb.append("  \"clientRoundTripMs\": ").append(clientRoundTripMs).append(",\n");
        sb.append("  \"errorKind\": ").append(JsonStrings.quote(e.getKind().name())).append(",\n");
        sb.append("  \"httpStatus\": ").append(e.getHttpStatus()).append(",\n");
        String msg = e.getMessage() != null ? e.getMessage() : "";
        if (msg.length() > MAX_ERR_LEN) {
            msg = msg.substring(0, MAX_ERR_LEN) + "…";
        }
        sb.append("  \"errorMessage\": ").append(JsonStrings.quote(msg)).append("\n");
        sb.append("}\n");
        Files.writeString(reportOutputDir.resolve(RECEIPT_FILENAME), sb.toString(), StandardCharsets.UTF_8);
    }

    static void writeCancelled(
            Path reportOutputDir,
            Instant uploadStartedAt,
            Instant uploadResponseAt,
            long clientRoundTripMs)
            throws IOException {
        StringBuilder sb = new StringBuilder(200);
        sb.append("{\n");
        sb.append("  \"uploadStatus\": \"cancelled\",\n");
        sb.append("  \"uploadStartedAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadStartedAt))).append(",\n");
        sb.append("  \"uploadResponseAt\": ").append(JsonStrings.quote(ISO_INST.format(uploadResponseAt))).append(",\n");
        sb.append("  \"clientRoundTripMs\": ").append(clientRoundTripMs).append(",\n");
        sb.append("  \"reason\": ").append(JsonStrings.quote("user_cancelled")).append("\n");
        sb.append("}\n");
        Files.writeString(reportOutputDir.resolve(RECEIPT_FILENAME), sb.toString(), StandardCharsets.UTF_8);
    }

    private static void appendTimingInline(StringBuilder sb, UploadResponse.UploadTiming t) {
        sb.append("{\n");
        sb.append("    \"integrityMs\": ").append(t.getIntegrityMs()).append(",\n");
        sb.append("    \"chainMs\": ").append(t.getChainMs()).append(",\n");
        sb.append("    \"totalMs\": ").append(t.getTotalMs());
        if (t.hasCaseRegistryMs()) {
            sb.append(",\n    \"caseRegistryMs\": ").append(t.getCaseRegistryMs());
        }
        sb.append("\n  }");
    }
}
