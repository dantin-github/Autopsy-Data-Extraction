package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal JSON object parser (strings, numbers, nested objects). For gateway DTO parsing only.
 */
final class SimpleJson {

    private final String s;
    private int pos;

    private SimpleJson(String s) {
        this.s = s;
    }

    static Map<String, Object> parseObject(String json) throws JsonParseException {
        if (json == null) {
            throw new JsonParseException("null input");
        }
        SimpleJson p = new SimpleJson(json.trim());
        Map<String, Object> o = p.readObject();
        p.skipWs();
        if (p.pos < p.s.length()) {
            throw new JsonParseException("trailing data");
        }
        return o;
    }

    private void skipWs() {
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                pos++;
            } else {
                break;
            }
        }
    }

    private Map<String, Object> readObject() throws JsonParseException {
        skipWs();
        expect('{');
        Map<String, Object> m = new LinkedHashMap<>();
        skipWs();
        if (peek('}')) {
            pos++;
            return m;
        }
        while (true) {
            skipWs();
            String key = readString();
            skipWs();
            expect(':');
            skipWs();
            Object val = readValue();
            m.put(key, val);
            skipWs();
            if (peek('}')) {
                pos++;
                return m;
            }
            expect(',');
        }
    }

    private Object readValue() throws JsonParseException {
        skipWs();
        if (pos >= s.length()) {
            throw new JsonParseException("unexpected end");
        }
        char c = s.charAt(pos);
        if (c == '"') {
            return readString();
        }
        if (c == '{') {
            return readObject();
        }
        if (c == '-' || (c >= '0' && c <= '9')) {
            return readNumber();
        }
        if (s.startsWith("null", pos)) {
            pos += 4;
            return null;
        }
        if (s.startsWith("true", pos)) {
            pos += 4;
            return Boolean.TRUE;
        }
        if (s.startsWith("false", pos)) {
            pos += 5;
            return Boolean.FALSE;
        }
        throw new JsonParseException("bad value at " + pos);
    }

    private Number readNumber() throws JsonParseException {
        int start = pos;
        if (peek('-')) {
            pos++;
        }
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
                pos++;
            } else {
                break;
            }
        }
        String sub = s.substring(start, pos);
        try {
            if (sub.contains(".") || sub.contains("e") || sub.contains("E")) {
                return Double.parseDouble(sub);
            }
            return Long.parseLong(sub);
        } catch (NumberFormatException e) {
            throw new JsonParseException("bad number: " + sub);
        }
    }

    private String readString() throws JsonParseException {
        skipWs();
        expect('"');
        StringBuilder sb = new StringBuilder();
        while (pos < s.length()) {
            char c = s.charAt(pos++);
            if (c == '"') {
                return sb.toString();
            }
            if (c == '\\') {
                if (pos >= s.length()) {
                    throw new JsonParseException("bad escape");
                }
                char e = s.charAt(pos++);
                switch (e) {
                    case '"', '\\', '/' -> sb.append(e);
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'n' -> sb.append('\n');
                    case 'r' -> sb.append('\r');
                    case 't' -> sb.append('\t');
                    case 'u' -> {
                        if (pos + 4 > s.length()) {
                            throw new JsonParseException("bad \\u");
                        }
                        int cp = Integer.parseInt(s.substring(pos, pos + 4), 16);
                        pos += 4;
                        sb.append((char) cp);
                    }
                    default -> throw new JsonParseException("bad escape \\" + e);
                }
            } else {
                sb.append(c);
            }
        }
        throw new JsonParseException("unclosed string");
    }

    private boolean peek(char c) {
        return pos < s.length() && s.charAt(pos) == c;
    }

    private void expect(char c) throws JsonParseException {
        skipWs();
        if (pos >= s.length() || s.charAt(pos) != c) {
            throw new JsonParseException("expected '" + c + "' at " + pos);
        }
        pos++;
    }

    static final class JsonParseException extends Exception {
        JsonParseException(String m) {
            super(m);
        }
    }
}
