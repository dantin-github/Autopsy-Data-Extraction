package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Phase 4 S4.7: client-side HTTP round-trip for {@link GatewayClient#uploadCase} — start immediately before
 * {@link java.net.URL#openConnection()}, end in {@code finally} after the response body has been read or an I/O error
 * occurred (same instants used for {@code upload_receipt.json}).
 */
public final class UploadClientTiming {

    private Instant uploadStartedAt;
    private Instant uploadResponseAt;

    public UploadClientTiming() {
    }

    /** Called once immediately before opening the HTTP connection. */
    void markHttpRequestStarted() {
        uploadStartedAt = Instant.now();
    }

    /**
     * Called from {@link GatewayClient} {@code finally}. Sets response end time; if the request never reached
     * {@link #markHttpRequestStarted()} (e.g. early validation), both timestamps collapse to the same instant (0 ms RTT).
     */
    void finishHttpAttempt() {
        Instant end = Instant.now();
        if (uploadStartedAt == null) {
            uploadStartedAt = end;
        }
        uploadResponseAt = end;
    }

    public Instant getUploadStartedAt() {
        return uploadStartedAt;
    }

    public Instant getUploadResponseAt() {
        return uploadResponseAt;
    }

    public long getClientRoundTripMs() {
        if (uploadStartedAt == null || uploadResponseAt == null) {
            return 0L;
        }
        return ChronoUnit.MILLIS.between(uploadStartedAt, uploadResponseAt);
    }
}
