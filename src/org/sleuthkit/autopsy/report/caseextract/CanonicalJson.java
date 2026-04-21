package org.sleuthkit.autopsy.report.caseextract;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * Canonical JSON for {@code aggregateHash}: parse → clear {@code aggregateHash} /
 * {@code aggregateHashNote} → deep lexicographic key sort at every object →
 * {@code JSON.stringify}-compatible compact UTF-8 serialization → SHA-256 hex.
 * <p>
 * Matches api-gateway {@code src/services/integrity.js} ({@code computeHash}).
 */
public final class CanonicalJson {

    private static final double MAX_SAFE_INTEGER = 9007199254740991.0;

    private CanonicalJson() {
    }

    /**
     * @param caseDataJson full case report JSON (UTF-8), same input as gateway {@code computeHash}
     * @return lowercase hex SHA-256 of canonical body
     */
    public static String computeAggregateHash(String caseDataJson) {
        String canonical = toCanonicalJsonString(caseDataJson);
        return sha256HexUtf8(canonical);
    }

    /**
     * Canonical JSON string (compact, no extra whitespace) after clearing hash fields and sorting keys.
     */
    public static String toCanonicalJsonString(String caseDataJson) {
        JsonValue root = new Parser(caseDataJson).parse();
        if (!(root instanceof JsonObject)) {
            throw new IllegalArgumentException("Root JSON value must be an object");
        }
        JsonObject obj = (JsonObject) root;
        obj.map.put("aggregateHash", new JsonString(""));
        obj.map.put("aggregateHashNote", new JsonString(""));
        return stringify(sortKeysDeep(obj));
    }

    private static JsonValue sortKeysDeep(JsonValue v) {
        if (v instanceof JsonObject) {
            Map<String, JsonValue> src = ((JsonObject) v).map;
            TreeMap<String, JsonValue> sorted = new TreeMap<>();
            for (Map.Entry<String, JsonValue> e : src.entrySet()) {
                sorted.put(e.getKey(), sortKeysDeep(e.getValue()));
            }
            return new JsonObject(sorted);
        }
        if (v instanceof JsonArray) {
            List<JsonValue> src = ((JsonArray) v).elements;
            List<JsonValue> out = new ArrayList<>(src.size());
            for (JsonValue x : src) {
                out.add(sortKeysDeep(x));
            }
            return new JsonArray(out);
        }
        return v;
    }

    private static String stringify(JsonValue v) {
        StringBuilder sb = new StringBuilder();
        appendValue(sb, v);
        return sb.toString();
    }

    private static void appendValue(StringBuilder sb, JsonValue v) {
        if (v instanceof JsonNull) {
            sb.append("null");
        } else if (v instanceof JsonBool) {
            sb.append(((JsonBool) v).value ? "true" : "false");
        } else if (v instanceof JsonNumber) {
            ((JsonNumber) v).appendTo(sb);
        } else if (v instanceof JsonString) {
            escapeString(sb, ((JsonString) v).value);
        } else if (v instanceof JsonArray) {
            sb.append('[');
            List<JsonValue> el = ((JsonArray) v).elements;
            for (int i = 0; i < el.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                appendValue(sb, el.get(i));
            }
            sb.append(']');
        } else if (v instanceof JsonObject) {
            sb.append('{');
            Map<String, JsonValue> m = ((JsonObject) v).map;
            boolean first = true;
            for (Map.Entry<String, JsonValue> e : m.entrySet()) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                escapeString(sb, e.getKey());
                sb.append(':');
                appendValue(sb, e.getValue());
            }
            sb.append('}');
        } else {
            throw new IllegalStateException("Unknown JsonValue");
        }
    }

    private static void escapeString(StringBuilder sb, String str) {
        sb.append('"');
        for (int i = 0; i < str.length();) {
            int cp = str.codePointAt(i);
            i += Character.charCount(cp);
            switch (cp) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (cp < 0x20) {
                        sb.append("\\u");
                        sb.append(String.format(Locale.ROOT, "%04x", cp));
                    } else {
                        sb.appendCodePoint(cp);
                    }
            }
        }
        sb.append('"');
    }

    private static String sha256HexUtf8(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /* ---- JSON model ---- */

    private abstract static class JsonValue {
    }

    private static final class JsonNull extends JsonValue {
        private static final JsonNull INSTANCE = new JsonNull();

        private JsonNull() {
        }
    }

    private static final class JsonBool extends JsonValue {
        private final boolean value;

        private JsonBool(boolean value) {
            this.value = value;
        }
    }

    private static final class JsonNumber extends JsonValue {
        private final boolean isLong;
        private final long longValue;
        private final double doubleValue;

        private JsonNumber(long longValue) {
            this.isLong = true;
            this.longValue = longValue;
            this.doubleValue = 0;
        }

        private JsonNumber(double doubleValue) {
            this.isLong = false;
            this.longValue = 0;
            this.doubleValue = doubleValue;
        }

        static JsonNumber fromLong(long v) {
            return new JsonNumber(v);
        }

        static JsonNumber fromDouble(double v) {
            return new JsonNumber(v);
        }

        void appendTo(StringBuilder sb) {
            if (isLong) {
                sb.append(Long.toString(longValue));
                return;
            }
            double d = doubleValue;
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                throw new IllegalArgumentException("Non-finite number cannot appear in canonical JSON");
            }
            long asLong = (long) d;
            if (d == (double) asLong && Math.abs(d) <= MAX_SAFE_INTEGER) {
                sb.append(Long.toString(asLong));
                return;
            }
            sb.append(Double.toString(d));
        }
    }

    private static final class JsonString extends JsonValue {
        private final String value;

        private JsonString(String value) {
            this.value = value;
        }
    }

    private static final class JsonArray extends JsonValue {
        private final List<JsonValue> elements;

        private JsonArray(List<JsonValue> elements) {
            this.elements = elements;
        }
    }

    private static final class JsonObject extends JsonValue {
        private final Map<String, JsonValue> map;

        private JsonObject(Map<String, JsonValue> map) {
            this.map = map;
        }
    }

    /* ---- Recursive-descent parser (RFC 8259 subset for reports) ---- */

    private static final class Parser {
        private final String s;
        private final int len;
        private int pos;

        Parser(String s) {
            this.s = s;
            this.len = s.length();
            this.pos = 0;
        }

        JsonValue parse() {
            JsonValue v = parseValue();
            skipWs();
            if (pos < len) {
                throw new IllegalArgumentException("Trailing data at position " + pos);
            }
            return v;
        }

        private JsonValue parseValue() {
            skipWs();
            if (pos >= len) {
                throw new IllegalArgumentException("Unexpected end of input");
            }
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    return parseObject();
                case '[':
                    return parseArray();
                case '"':
                    return new JsonString(parseStringQuoted());
                case 'n':
                    expectLiteral("null");
                    return JsonNull.INSTANCE;
                case 't':
                    expectLiteral("true");
                    return new JsonBool(true);
                case 'f':
                    expectLiteral("false");
                    return new JsonBool(false);
                case '-':
                case '0':
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    return parseNumber();
                default:
                    throw new IllegalArgumentException("Unexpected character at " + pos + ": " + c);
            }
        }

        private JsonObject parseObject() {
            expect('{');
            skipWs();
            Map<String, JsonValue> m = new LinkedHashMap<>();
            if (peek() == '}') {
                pos++;
                return new JsonObject(m);
            }
            while (true) {
                skipWs();
                if (pos >= len || s.charAt(pos) != '"') {
                    throw new IllegalArgumentException("Expected string key at " + pos);
                }
                String key = parseStringQuoted();
                skipWs();
                expect(':');
                JsonValue val = parseValue();
                m.put(key, val);
                skipWs();
                char d = peek();
                if (d == '}') {
                    pos++;
                    return new JsonObject(m);
                }
                if (d != ',') {
                    throw new IllegalArgumentException("Expected , or } at " + pos);
                }
                pos++;
            }
        }

        private JsonArray parseArray() {
            expect('[');
            skipWs();
            List<JsonValue> list = new ArrayList<>();
            if (peek() == ']') {
                pos++;
                return new JsonArray(list);
            }
            while (true) {
                list.add(parseValue());
                skipWs();
                char d = peek();
                if (d == ']') {
                    pos++;
                    return new JsonArray(list);
                }
                if (d != ',') {
                    throw new IllegalArgumentException("Expected , or ] at " + pos);
                }
                pos++;
                skipWs();
            }
        }

        private JsonNumber parseNumber() {
            int start = pos;
            if (peek() == '-') {
                pos++;
            }
            int intStart = pos;
            if (pos >= len) {
                throw new IllegalArgumentException("Bad number");
            }
            char c0 = s.charAt(pos);
            if (c0 == '0') {
                pos++;
            } else if (c0 >= '1' && c0 <= '9') {
                pos++;
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
            } else {
                throw new IllegalArgumentException("Bad number at " + pos);
            }
            boolean hasFrac = false;
            boolean hasExp = false;
            if (pos < len && s.charAt(pos) == '.') {
                hasFrac = true;
                pos++;
                int fracStart = pos;
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
                if (fracStart == pos) {
                    throw new IllegalArgumentException("Bad fraction at " + pos);
                }
            }
            if (pos < len && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                hasExp = true;
                pos++;
                if (pos < len && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) {
                    pos++;
                }
                int expStart = pos;
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
                if (expStart == pos) {
                    throw new IllegalArgumentException("Bad exponent at " + pos);
                }
            }
            if (!hasFrac && !hasExp && intStart < pos) {
                if (s.charAt(intStart) == '0' && pos - intStart > 1) {
                    throw new IllegalArgumentException("Leading zero in integer at " + intStart);
                }
            }
            String raw = s.substring(start, pos);
            if (!hasFrac && !hasExp) {
                try {
                    return JsonNumber.fromLong(Long.parseLong(raw));
                } catch (NumberFormatException ex) {
                    /* fall through to double */
                }
            }
            return JsonNumber.fromDouble(Double.parseDouble(raw));
        }

        /** Called with {@code pos} at opening {@code "}. */
        private String parseStringQuoted() {
            if (pos >= len || s.charAt(pos) != '"') {
                throw new IllegalArgumentException("Expected opening quote at " + pos);
            }
            pos++;
            return parseStringContent();
        }

        private String parseStringContent() {
            StringBuilder out = new StringBuilder();
            while (pos < len) {
                char c = s.charAt(pos++);
                if (c == '"') {
                    return out.toString();
                }
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                if (pos >= len) {
                    throw new IllegalArgumentException("Bad escape");
                }
                char e = s.charAt(pos++);
                switch (e) {
                    case '"':
                        out.append('"');
                        break;
                    case '\\':
                        out.append('\\');
                        break;
                    case '/':
                        out.append('/');
                        break;
                    case 'b':
                        out.append('\b');
                        break;
                    case 'f':
                        out.append('\f');
                        break;
                    case 'n':
                        out.append('\n');
                        break;
                    case 'r':
                        out.append('\r');
                        break;
                    case 't':
                        out.append('\t');
                        break;
                    case 'u':
                        if (pos + 4 > len) {
                            throw new IllegalArgumentException("Bad \\u escape");
                        }
                        int code = parseHex4(pos);
                        pos += 4;
                        if (code >= 0xD800 && code <= 0xDBFF && pos + 5 <= len
                                && s.charAt(pos) == '\\' && s.charAt(pos + 1) == 'u') {
                            int low = parseHex4(pos + 2);
                            if (low >= 0xDC00 && low <= 0xDFFF) {
                                pos += 6;
                                int full = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                out.appendCodePoint(full);
                                break;
                            }
                        }
                        out.append((char) code);
                        break;
                    default:
                        throw new IllegalArgumentException("Bad escape \\" + e);
                }
            }
            throw new IllegalArgumentException("Unterminated string");
        }

        private int parseHex4(int i) {
            int v = 0;
            for (int k = 0; k < 4; k++) {
                char c = s.charAt(i + k);
                int d;
                if (c >= '0' && c <= '9') {
                    d = c - '0';
                } else if (c >= 'a' && c <= 'f') {
                    d = 10 + (c - 'a');
                } else if (c >= 'A' && c <= 'F') {
                    d = 10 + (c - 'A');
                } else {
                    throw new IllegalArgumentException("Bad hex in \\u");
                }
                v = (v << 4) | d;
            }
            return v;
        }

        private void expect(char c) {
            skipWs();
            if (pos >= len || s.charAt(pos) != c) {
                throw new IllegalArgumentException("Expected '" + c + "' at " + pos);
            }
            pos++;
        }

        private void expectLiteral(String lit) {
            if (pos + lit.length() > len || !s.regionMatches(pos, lit, 0, lit.length())) {
                throw new IllegalArgumentException("Expected " + lit + " at " + pos);
            }
            pos += lit.length();
        }

        private char peek() {
            skipWs();
            if (pos >= len) {
                return '\0';
            }
            return s.charAt(pos);
        }

        private void skipWs() {
            while (pos < len) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                    pos++;
                } else {
                    break;
                }
            }
        }

        private static boolean isDigit(char c) {
            return c >= '0' && c <= '9';
        }
    }
}
