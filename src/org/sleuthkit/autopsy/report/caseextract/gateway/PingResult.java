package org.sleuthkit.autopsy.report.caseextract.gateway;

/**
 * Result of {@link GatewayClient#ping(String)} against {@code GET /health}.
 */
public final class PingResult {

    private final boolean ok;
    private final long latencyMs;
    private final String message;

    public PingResult(boolean ok, long latencyMs, String message) {
        this.ok = ok;
        this.latencyMs = latencyMs;
        this.message = message != null ? message : "";
    }

    public boolean isOk() {
        return ok;
    }

    public long getLatencyMs() {
        return latencyMs;
    }

    public String getMessage() {
        return message;
    }
}
