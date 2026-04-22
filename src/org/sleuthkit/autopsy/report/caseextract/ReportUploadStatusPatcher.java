package org.sleuthkit.autopsy.report.caseextract;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayUploadException;
import org.sleuthkit.autopsy.report.caseextract.gateway.JsonStrings;
import org.sleuthkit.autopsy.report.caseextract.gateway.UploadResponse;

/**
 * Phase 4 S4.4: append {@code uploadStatus} and {@code uploadDetail} to {@code case_data_extract.json} after upload
 * (string patch before the root closing brace). Canonical aggregate hash ignores these keys (see {@link CanonicalJson}).
 */
public final class ReportUploadStatusPatcher {

    private ReportUploadStatusPatcher() {
    }

    static void patchSuccess(Path caseJsonFile, UploadResponse resp, long clientRoundTripMs) throws IOException {
        String detail = buildDetailSuccess(resp, clientRoundTripMs);
        patch(caseJsonFile, "success", detail);
    }

    static void patchFailure(Path caseJsonFile, GatewayUploadException e, long clientRoundTripMs) throws IOException {
        String detail = buildDetailFailure(e, clientRoundTripMs);
        patch(caseJsonFile, "failed", detail);
    }

    static void patchSkipped(Path caseJsonFile, String reasonCode) throws IOException {
        String detail = "{\n  \"reason\": " + JsonStrings.quote(reasonCode) + "\n}";
        patch(caseJsonFile, "skipped", detail);
    }

    static void patchCancelled(Path caseJsonFile, long clientRoundTripMs) throws IOException {
        String detail =
                "{\n  \"reason\": "
                        + JsonStrings.quote("user_cancelled")
                        + ",\n  \"clientRoundTripMs\": "
                        + clientRoundTripMs
                        + "\n}";
        patch(caseJsonFile, "cancelled", detail);
    }

    private static String buildDetailSuccess(UploadResponse resp, long clientRoundTripMs) {
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\n");
        sb.append("  \"indexHash\": ").append(JsonStrings.quote(resp.getIndexHash())).append(",\n");
        sb.append("  \"recordHash\": ").append(JsonStrings.quote(resp.getRecordHash())).append(",\n");
        sb.append("  \"txHash\": ").append(JsonStrings.quote(resp.getTxHash())).append(",\n");
        sb.append("  \"blockNumber\": ").append(resp.getBlockNumber()).append(",\n");
        if (resp.getCaseRegistryTxHash() != null && !resp.getCaseRegistryTxHash().isBlank()) {
            sb.append("  \"caseRegistryTxHash\": ")
                    .append(JsonStrings.quote(resp.getCaseRegistryTxHash()))
                    .append(",\n");
        }
        if (resp.getCaseRegistryBlockNumber() != null) {
            sb.append("  \"caseRegistryBlockNumber\": ")
                    .append(resp.getCaseRegistryBlockNumber())
                    .append(",\n");
        }
        if (resp.getRequestId() != null && !resp.getRequestId().isBlank()) {
            sb.append("  \"requestId\": ").append(JsonStrings.quote(resp.getRequestId())).append(",\n");
        }
        sb.append("  \"clientRoundTripMs\": ").append(clientRoundTripMs).append("\n");
        sb.append("}");
        return sb.toString();
    }

    private static String buildDetailFailure(GatewayUploadException e, long clientRoundTripMs) {
        String msg = e.getMessage() != null ? e.getMessage() : "";
        if (msg.length() > 2000) {
            msg = msg.substring(0, 2000) + "…";
        }
        return "{\n"
                + "  \"errorKind\": "
                + JsonStrings.quote(e.getKind().name())
                + ",\n"
                + "  \"httpStatus\": "
                + e.getHttpStatus()
                + ",\n"
                + "  \"clientRoundTripMs\": "
                + clientRoundTripMs
                + ",\n"
                + "  \"errorMessage\": "
                + JsonStrings.quote(msg)
                + "\n}";
    }

    static void patch(Path caseJsonFile, String uploadStatus, String uploadDetailObject) throws IOException {
        String content = Files.readString(caseJsonFile, StandardCharsets.UTF_8);
        if (content.indexOf("\"uploadStatus\"") >= 0) {
            return;
        }
        int lastBrace = content.lastIndexOf('}');
        if (lastBrace < 0) {
            throw new IOException("Invalid case JSON: no closing brace");
        }
        String prefix = content.substring(0, lastBrace).stripTrailing();
        String insert =
                ",\n  \"uploadStatus\": "
                        + JsonStrings.quote(uploadStatus)
                        + ",\n  \"uploadDetail\": "
                        + uploadDetailObject.trim()
                        + "\n";
        Files.writeString(caseJsonFile, prefix + insert + "}", StandardCharsets.UTF_8);
    }
}
