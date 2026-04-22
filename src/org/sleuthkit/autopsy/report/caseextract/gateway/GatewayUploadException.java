package org.sleuthkit.autopsy.report.caseextract.gateway;

/**
 * Gateway upload or ping failure with a stable {@link Kind} for operator-facing messages.
 */
public final class GatewayUploadException extends Exception {

    public enum Kind {
        BAD_REQUEST,
        AGGREGATE_MISMATCH,
        TOKEN_CONSUMED,
        TOKEN_EXPIRED,
        FORBIDDEN,
        DUPLICATE,
        CHAIN_UNAVAILABLE,
        GATEWAY_UNREACHABLE,
        TIMEOUT,
        /** User cancelled from the report progress UI during {@code POST /api/upload} (Phase 4 S4.5). */
        CANCELLED,
        UNKNOWN
    }

    private final Kind kind;
    private final int httpStatus;
    private final GatewayError gatewayError;

    public GatewayUploadException(
            Kind kind,
            int httpStatus,
            String message,
            GatewayError gatewayError,
            Throwable cause) {
        super(message, cause);
        this.kind = kind;
        this.httpStatus = httpStatus;
        this.gatewayError = gatewayError;
    }

    public Kind getKind() {
        return kind;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    public GatewayError getGatewayError() {
        return gatewayError;
    }

    static Kind mapHttpToKind(int status, GatewayError ge, String errMsg) {
        String msg = errMsg != null ? errMsg.toLowerCase() : "";
        String code = ge != null && ge.getCode() != null ? ge.getCode().toLowerCase() : "";
        return switch (status) {
            case 400 -> {
                if (msg.contains("aggregate") || msg.contains("verification")) {
                    yield Kind.AGGREGATE_MISMATCH;
                }
                yield Kind.BAD_REQUEST;
            }
            case 401 -> {
                if (msg.contains("expired") || code.contains("expired")) {
                    yield Kind.TOKEN_EXPIRED;
                }
                yield Kind.TOKEN_CONSUMED;
            }
            case 403 -> Kind.FORBIDDEN;
            case 409 -> Kind.DUPLICATE;
            case 503 -> Kind.CHAIN_UNAVAILABLE;
            default -> Kind.UNKNOWN;
        };
    }

    static GatewayUploadException fromHttpResponse(int status, String body) {
        GatewayError ge = GatewayError.tryParse(body);
        String errMsg = ge != null ? ge.getError() : body;
        Kind kind = mapHttpToKind(status, ge, errMsg);
        return new GatewayUploadException(kind, status, errMsg != null ? errMsg : "", ge, null);
    }
}
