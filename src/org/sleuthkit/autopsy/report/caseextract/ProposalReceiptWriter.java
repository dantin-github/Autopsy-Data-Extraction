package org.sleuthkit.autopsy.report.caseextract;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.sleuthkit.autopsy.report.caseextract.gateway.GatewayUploadException;
import org.sleuthkit.autopsy.report.caseextract.gateway.JsonStrings;
import org.sleuthkit.autopsy.report.caseextract.gateway.ProposalResponse;

/**
 * Persists propose-with-token outcome beside {@code case_data_extract.json} (symmetric {@link UploadReceiptWriter}).
 */
public final class ProposalReceiptWriter {

    static final String RECEIPT_FILENAME = "proposal_receipt.json";

    private static final DateTimeFormatter ISO_INST = DateTimeFormatter.ISO_INSTANT;
    private static final int MAX_ERR_LEN = 4000;

    private ProposalReceiptWriter() {
    }

    static void writeSuccess(
            Path reportOutputDir,
            Instant requestStartedAt,
            Instant responseAt,
            long clientRoundTripMs,
            ProposalResponse resp)
            throws IOException {
        StringBuilder sb = new StringBuilder(512);
        sb.append("{\n");
        sb.append("  \"proposalStatus\": \"success\",\n");
        sb.append("  \"requestStartedAt\": ").append(JsonStrings.quote(ISO_INST.format(requestStartedAt))).append(",\n");
        sb.append("  \"responseAt\": ").append(JsonStrings.quote(ISO_INST.format(responseAt))).append(",\n");
        sb.append("  \"clientRoundTripMs\": ").append(clientRoundTripMs).append(",\n");
        sb.append("  \"proposalId\": ").append(JsonStrings.quote(resp.getProposalId())).append(",\n");
        sb.append("  \"txHash\": ").append(JsonStrings.quote(resp.getTxHash())).append(",\n");
        sb.append("  \"blockNumber\": ").append(resp.getBlockNumber());
        if (resp.getCaseId() != null && !resp.getCaseId().isBlank()) {
            sb.append(",\n  \"caseId\": ").append(JsonStrings.quote(resp.getCaseId()));
        }
        if (resp.getIndexHash() != null && !resp.getIndexHash().isBlank()) {
            sb.append(",\n  \"indexHash\": ").append(JsonStrings.quote(resp.getIndexHash()));
        }
        if (resp.getOldRecordHash() != null && !resp.getOldRecordHash().isBlank()) {
            sb.append(",\n  \"oldRecordHash\": ").append(JsonStrings.quote(resp.getOldRecordHash()));
        }
        if (resp.getNewRecordHash() != null && !resp.getNewRecordHash().isBlank()) {
            sb.append(",\n  \"newRecordHash\": ").append(JsonStrings.quote(resp.getNewRecordHash()));
        }
        if (resp.getPendingKey() != null && !resp.getPendingKey().isBlank()) {
            sb.append(",\n  \"pendingKey\": ").append(JsonStrings.quote(resp.getPendingKey()));
        }
        sb.append("\n}\n");
        Files.writeString(reportOutputDir.resolve(RECEIPT_FILENAME), sb.toString(), StandardCharsets.UTF_8);
    }

    static void writeFailure(
            Path reportOutputDir,
            Instant requestStartedAt,
            Instant responseAt,
            long clientRoundTripMs,
            GatewayUploadException e)
            throws IOException {
        StringBuilder sb = new StringBuilder(384);
        sb.append("{\n");
        sb.append("  \"proposalStatus\": \"failed\",\n");
        sb.append("  \"requestStartedAt\": ").append(JsonStrings.quote(ISO_INST.format(requestStartedAt))).append(",\n");
        sb.append("  \"responseAt\": ").append(JsonStrings.quote(ISO_INST.format(responseAt))).append(",\n");
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
}
