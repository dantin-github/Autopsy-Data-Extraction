package org.sleuthkit.autopsy.report.caseextract;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Cross-tests {@link CanonicalJson} against api-gateway fixture
 * {@code test/fixtures/autopsy-aggregate-samples.jsonl} (hash + canonical UTF-8 bytes).
 * <p>
 * Run from repository root: {@code ant test-canonical} (requires {@code compile-test}).
 */
public final class CanonicalJsonTest {

    private static final Pattern EXPECTED_HASH = Pattern.compile(
            "\"expectedGatewayAggregateHash\":\"([a-f0-9]{64})\"");
    private static final Pattern CANONICAL_B64 = Pattern.compile(
            "\"canonicalUtf8Base64\":\"([A-Za-z0-9+/=]+)\"");
    private static final String CASE_JSON_START = "\"caseJson\":\"";

    private CanonicalJsonTest() {
    }

    public static void main(String[] args) throws Exception {
        testIntegrityJsBaseline();
        testFixtureFile(resolveFixturePath(args));
        System.out.println("CanonicalJsonTest: all assertions passed.");
    }

    private static Path resolveFixturePath(String[] args) {
        if (args != null && args.length >= 1 && args[0] != null && !args[0].isEmpty()) {
            return Paths.get(args[0]);
        }
        Path cwd = Paths.get(System.getProperty("user.dir", "."));
        Path p = cwd.resolve("api-gateway").resolve("test").resolve("fixtures")
                .resolve("autopsy-aggregate-samples.jsonl");
        if (!Files.isRegularFile(p)) {
            throw new IllegalStateException(
                    "Fixture not found: " + p.toAbsolutePath()
                            + " (run from repo root or pass path as first arg)");
        }
        return p;
    }

    /** Same sample as api-gateway/test/integrity.test.js */
    private static void testIntegrityJsBaseline() {
        String base = "{\"caseId\":\"TEST-2025-001\",\"examiner\":\"police\",\"aggregateHash\":\"\",\"aggregateHashNote\":\"\"}";
        String expected = "bee2393f2d6ac949e47eab0f6a7e04d6eb1747f5c59905d98f4983adbd4a1789";
        String got = CanonicalJson.computeAggregateHash(base);
        assertEq(expected, got, "integrity.test.js baseline hash");
    }

    private static void testFixtureFile(Path fixture) throws IOException {
        List<String> lines = Files.readAllLines(fixture, StandardCharsets.UTF_8);
        int n = 0;
        for (String line : lines) {
            line = line.trim();
            if (line.isEmpty()) {
                continue;
            }
            n++;
            String caseJson = extractCaseJson(line);
            Matcher hm = EXPECTED_HASH.matcher(line);
            if (!hm.find()) {
                throw new AssertionError("expectedGatewayAggregateHash not found in line " + n);
            }
            String expHash = hm.group(1);
            String gotHash = CanonicalJson.computeAggregateHash(caseJson);
            assertEq(expHash, gotHash, "fixture line " + n + " aggregate hash");

            String canonical = CanonicalJson.toCanonicalJsonString(caseJson);
            byte[] utf8 = canonical.getBytes(StandardCharsets.UTF_8);

            Matcher bm = CANONICAL_B64.matcher(line);
            if (bm.find()) {
                byte[] expBytes = Base64.getDecoder().decode(bm.group(1));
                if (!Arrays.equals(utf8, expBytes)) {
                    throw new AssertionError("fixture line " + n + ": canonical UTF-8 bytes differ from Node\n"
                            + "Java len=" + utf8.length + " Node len=" + expBytes.length);
                }
            }
        }
        if (n < 10) {
            throw new AssertionError("expected at least 10 fixture rows, got " + n);
        }
    }

    private static String extractCaseJson(String line) {
        int i = line.indexOf(CASE_JSON_START);
        if (i < 0) {
            throw new IllegalArgumentException("caseJson field not found");
        }
        i += CASE_JSON_START.length();
        StringBuilder sb = new StringBuilder();
        final String endMark = ",\"expectedGatewayAggregateHash\"";
        while (i < line.length()) {
            char c = line.charAt(i);
            if (c == '\\') {
                if (i + 1 >= line.length()) {
                    throw new IllegalArgumentException("bad escape in caseJson");
                }
                char e = line.charAt(i + 1);
                switch (e) {
                    case '"':
                        sb.append('"');
                        i += 2;
                        continue;
                    case '\\':
                        sb.append('\\');
                        i += 2;
                        continue;
                    case '/':
                        sb.append('/');
                        i += 2;
                        continue;
                    case 'b':
                        sb.append('\b');
                        i += 2;
                        continue;
                    case 'f':
                        sb.append('\f');
                        i += 2;
                        continue;
                    case 'n':
                        sb.append('\n');
                        i += 2;
                        continue;
                    case 'r':
                        sb.append('\r');
                        i += 2;
                        continue;
                    case 't':
                        sb.append('\t');
                        i += 2;
                        continue;
                    case 'u':
                        if (i + 6 > line.length()) {
                            throw new IllegalArgumentException("bad \\u in caseJson");
                        }
                        int cp = parseHex4(line, i + 2);
                        i += 6;
                        if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= line.length()
                                && line.charAt(i) == '\\' && line.charAt(i + 1) == 'u') {
                            int low = parseHex4(line, i + 2);
                            if (low >= 0xDC00 && low <= 0xDFFF) {
                                int full = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                                sb.appendCodePoint(full);
                                i += 6;
                                continue;
                            }
                        }
                        sb.append((char) cp);
                        continue;
                    default:
                        throw new IllegalArgumentException("bad escape \\" + e + " in caseJson");
                }
            }
            if (c == '"') {
                if (!line.regionMatches(i + 1, endMark, 0, endMark.length())) {
                    throw new IllegalArgumentException("caseJson terminator not found at " + i);
                }
                return sb.toString();
            }
            sb.append(c);
            i++;
        }
        throw new IllegalArgumentException("unterminated caseJson string");
    }

    private static int parseHex4(String s, int offset) {
        int v = 0;
        for (int k = 0; k < 4; k++) {
            char c = s.charAt(offset + k);
            int d;
            if (c >= '0' && c <= '9') {
                d = c - '0';
            } else if (c >= 'a' && c <= 'f') {
                d = 10 + (c - 'a');
            } else if (c >= 'A' && c <= 'F') {
                d = 10 + (c - 'A');
            } else {
                throw new IllegalArgumentException("bad hex in \\u");
            }
            v = (v << 4) | d;
        }
        return v;
    }

    private static void assertEq(String expected, String actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + "\nexpected: " + expected + "\nactual:   " + actual);
        }
    }
}
