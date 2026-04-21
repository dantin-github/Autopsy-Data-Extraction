package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.util.Map;

/**
 * Error body from gateway JSON: {@code { "error": "...", "code"?: "...", "revertReason"?: "..." }}.
 */
public final class GatewayError {

    private final String error;
    private final String code;
    private final String revertReason;

    public GatewayError(String error, String code, String revertReason) {
        this.error = error;
        this.code = code;
        this.revertReason = revertReason;
    }

    public String getError() {
        return error;
    }

    public String getCode() {
        return code;
    }

    public String getRevertReason() {
        return revertReason;
    }

    /**
     * @return parsed error or null if body is not a JSON object with {@code error}
     */
    public static GatewayError tryParse(String body) {
        if (body == null) {
            return null;
        }
        String t = body.trim();
        if (t.isEmpty() || t.charAt(0) != '{') {
            return null;
        }
        try {
            Map<String, Object> m = SimpleJson.parseObject(t);
            Object e = m.get("error");
            if (!(e instanceof String)) {
                return null;
            }
            String code = m.get("code") instanceof String ? (String) m.get("code") : null;
            String rr =
                    m.get("revertReason") instanceof String ? (String) m.get("revertReason") : null;
            return new GatewayError((String) e, code, rr);
        } catch (SimpleJson.JsonParseException ex) {
            return null;
        }
    }
}
