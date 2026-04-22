package org.sleuthkit.autopsy.report.caseextract.gateway;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Mock HTTP exercises for {@link GatewayClient} (Phase 2 / S2.3).
 * Run: {@code ant test-gateway} from repo root (requires {@code ant compile} / Autopsy platform).
 */
public final class GatewayClientTest {

    private GatewayClientTest() {
    }

    public static void main(String[] args) throws Exception {
        testUploadRequestRoundtrip();
        testGatewayErrorTryParse();
        testUpload200();
        testUpload200WithTiming();
        test400AggregateMismatch();
        test401TokenConsumed();
        test401TokenExpired();
        test409Duplicate();
        test503ChainUnavailable();
        testUploadClientTimingS4_7();
        testPingOk();
        testPropose200();
        testPropose401();
        testPropose409();
        testPropose503();
        testCaseExistsTrue();
        testCaseExistsFalse();
        System.out.println("GatewayClientTest: all assertions passed.");
    }

    private static void testUploadRequestRoundtrip() throws Exception {
        UploadRequest r =
                new UploadRequest(
                        "C-1",
                        "alice",
                        "0xabc",
                        "2026-01-01T00:00:00.000Z",
                        "{\"caseId\":\"C-1\"}");
        UploadRequest withPw = r.withSigningPassword("secret");
        Map<String, Object> m = SimpleJson.parseObject(withPw.toJson());
        assertEq("C-1", m.get("caseId"));
        assertEq("alice", m.get("examiner"));
        assertEq("0xabc", m.get("aggregateHash"));
        assertEq("2026-01-01T00:00:00.000Z", m.get("generatedAt"));
        assertEq("{\"caseId\":\"C-1\"}", m.get("caseJson"));
        assertEq("secret", m.get("signingPassword"));
        Map<String, Object> m2 = SimpleJson.parseObject(r.toJson());
        if (m2.containsKey("signingPassword")) {
            throw new AssertionError("signingPassword should be omitted");
        }
    }

    private static void testGatewayErrorTryParse() {
        GatewayError ge = GatewayError.tryParse("{\"error\":\"x\",\"code\":\"E1\",\"revertReason\":\"r\"}");
        if (ge == null) {
            throw new AssertionError("expected error");
        }
        assertEq("x", ge.getError());
        assertEq("E1", ge.getCode());
        assertEq("r", ge.getRevertReason());
        if (GatewayError.tryParse("not json") != null) {
            throw new AssertionError();
        }
    }

    private static void testUpload200() throws Exception {
        String body =
                "{\"indexHash\":\"0x01\",\"recordHash\":\"0x02\",\"txHash\":\"0x03\",\"blockNumber\":42}";
        HttpServer srv = mockUploadServer(200, body);
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            UploadResponse res =
                    client.uploadCase(
                            "http://127.0.0.1:" + port,
                            new UploadRequest("c", "e", "h", "t", "{}"),
                            "tok",
                            null,
                            false);
            assertEq("0x01", res.getIndexHash());
            assertEq(42L, res.getBlockNumber());
            if (res.getRequestId() != null) {
                throw new AssertionError("requestId should be absent");
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testUpload200WithTiming() throws Exception {
        String body =
                "{\"indexHash\":\"0x01\",\"recordHash\":\"0x02\",\"txHash\":\"0x03\",\"blockNumber\":1,"
                        + "\"requestId\":\"550e8400-e29b-41d4-a716-446655440000\","
                        + "\"timing\":{\"integrityMs\":2,\"chainMs\":3,\"totalMs\":10},"
                        + "\"blockTimestampUtc\":\"2026-01-15T12:00:00.000Z\"}";
        HttpServer srv = mockUploadServer(200, body);
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            UploadResponse res =
                    client.uploadCase(
                            "http://127.0.0.1:" + port,
                            new UploadRequest("c", "e", "h", "t", "{}"),
                            "tok",
                            null,
                            true);
            assertEq("550e8400-e29b-41d4-a716-446655440000", res.getRequestId());
            if (res.getTiming() == null) {
                throw new AssertionError("timing");
            }
            assertEq(2L, res.getTiming().getIntegrityMs());
            assertEq(3L, res.getTiming().getChainMs());
            assertEq(10L, res.getTiming().getTotalMs());
            assertEq("2026-01-15T12:00:00.000Z", res.getBlockTimestampUtc());
        } finally {
            srv.stop(0);
        }
    }

    private static void test400AggregateMismatch() throws Exception {
        HttpServer srv =
                mockUploadServer(
                        400, "{\"error\":\"aggregate hash verification failed\"}");
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            try {
                client.uploadCase(
                        "http://127.0.0.1:" + port,
                        new UploadRequest("c", "e", "h", "t", "{}"),
                        "tok",
                        null,
                        false);
                throw new AssertionError("expected exception");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.AGGREGATE_MISMATCH) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void test401TokenConsumed() throws Exception {
        HttpServer srv = mockUploadServer(401, "{\"error\":\"Unauthorized\"}");
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            try {
                client.uploadCase(
                        "http://127.0.0.1:" + port,
                        new UploadRequest("c", "e", "h", "t", "{}"),
                        "tok",
                        null,
                        false);
                throw new AssertionError("expected exception");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.TOKEN_CONSUMED) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void test401TokenExpired() throws Exception {
        HttpServer srv = mockUploadServer(401, "{\"error\":\"OTP expired\",\"code\":\"TOKEN_EXPIRED\"}");
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            try {
                client.uploadCase(
                        "http://127.0.0.1:" + port,
                        new UploadRequest("c", "e", "h", "t", "{}"),
                        "tok",
                        null,
                        false);
                throw new AssertionError("expected exception");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.TOKEN_EXPIRED) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void test409Duplicate() throws Exception {
        HttpServer srv = mockUploadServer(409, "{\"error\":\"duplicate case\"}");
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            try {
                client.uploadCase(
                        "http://127.0.0.1:" + port,
                        new UploadRequest("c", "e", "h", "t", "{}"),
                        "tok",
                        null,
                        false);
                throw new AssertionError("expected exception");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.DUPLICATE) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testUploadClientTimingS4_7() throws Exception {
        String body =
                "{\"indexHash\":\"0x01\",\"recordHash\":\"0x02\",\"txHash\":\"0x03\",\"blockNumber\":1}";
        HttpServer srv = mockUploadServer(200, body);
        try {
            int port = srv.getAddress().getPort();
            UploadClientTiming timing = new UploadClientTiming();
            UploadResponse res =
                    new GatewayClient()
                            .uploadCase(
                                    "http://127.0.0.1:" + port,
                                    new UploadRequest("c", "e", "h", "t", "{}"),
                                    "tok",
                                    null,
                                    false,
                                    null,
                                    null,
                                    timing);
            assertEq("0x03", res.getTxHash());
            if (timing.getUploadStartedAt() == null || timing.getUploadResponseAt() == null) {
                throw new AssertionError("S4.7 timing instants must be set");
            }
            if (timing.getClientRoundTripMs() < 0) {
                throw new AssertionError("negative RTT");
            }
            if (!timing.getUploadResponseAt().equals(timing.getUploadStartedAt())
                    && timing.getUploadResponseAt().isBefore(timing.getUploadStartedAt())) {
                throw new AssertionError("end before start");
            }
        } finally {
            srv.stop(0);
        }
        HttpServer srv401 = mockUploadServer(401, "{\"error\":\"no\"}");
        try {
            int port = srv401.getAddress().getPort();
            UploadClientTiming timing = new UploadClientTiming();
            try {
                new GatewayClient()
                        .uploadCase(
                                "http://127.0.0.1:" + port,
                                new UploadRequest("c", "e", "h", "t", "{}"),
                                "tok",
                                null,
                                false,
                                null,
                                null,
                                timing);
                throw new AssertionError("expected 401");
            } catch (GatewayUploadException e) {
                if (timing.getUploadStartedAt() == null) {
                    throw new AssertionError("S4.7 start on failure");
                }
                if (timing.getUploadResponseAt() == null) {
                    throw new AssertionError("S4.7 end on failure");
                }
            }
        } finally {
            srv401.stop(0);
        }
    }

    private static void test503ChainUnavailable() throws Exception {
        HttpServer srv =
                mockUploadServer(
                        503, "{\"error\":\"Chain not configured:\\nx\"}");
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            try {
                client.uploadCase(
                        "http://127.0.0.1:" + port,
                        new UploadRequest("c", "e", "h", "t", "{}"),
                        "tok",
                        null,
                        false);
                throw new AssertionError("expected exception");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.CHAIN_UNAVAILABLE) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testPingOk() throws Exception {
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext(
                "/health",
                ex -> {
                    byte[] b = "{\"status\":\"ok\",\"uptime\":1}".getBytes(StandardCharsets.UTF_8);
                    ex.getResponseHeaders().add("Content-Type", "application/json");
                    ex.sendResponseHeaders(200, b.length);
                    try (OutputStream os = ex.getResponseBody()) {
                        os.write(b);
                    }
                });
        srv.setExecutor(null);
        srv.start();
        try {
            int port = srv.getAddress().getPort();
            GatewayClient client = new GatewayClient();
            PingResult p = client.ping("http://127.0.0.1:" + port);
            if (!p.isOk()) {
                throw new AssertionError("ping: " + p.getMessage());
            }
            if (p.getLatencyMs() < 0 || p.getLatencyMs() > 60_000) {
                throw new AssertionError("latency");
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testPropose200() throws Exception {
        String body =
                "{\"proposalId\":\"0xaa\",\"caseId\":\"C-1\",\"txHash\":\"0xbb\",\"blockNumber\":7,"
                        + "\"indexHash\":\"0x01\",\"oldRecordHash\":\"0x02\",\"newRecordHash\":\"0x03\","
                        + "\"pendingKey\":\"C-1::pending-0xaa\"}";
        HttpServer srv = mockProposeServer(200, body);
        try {
            int port = srv.getAddress().getPort();
            UploadClientTiming timing = new UploadClientTiming();
            ProposalResponse res =
                    new GatewayClient()
                            .proposeModification(
                                    "http://127.0.0.1:" + port,
                                    new UploadRequest("C-1", "e", "h", "t", "{}"),
                                    "tok",
                                    "pw",
                                    "because",
                                    timing);
            assertEq("0xaa", res.getProposalId());
            assertEq(7L, res.getBlockNumber());
            assertEq("C-1::pending-0xaa", res.getPendingKey());
            if (timing.getUploadStartedAt() == null) {
                throw new AssertionError("propose timing start");
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testPropose401() throws Exception {
        HttpServer srv = mockProposeServer(401, "{\"error\":\"Unauthorized\"}");
        try {
            int port = srv.getAddress().getPort();
            try {
                new GatewayClient()
                        .proposeModification(
                                "http://127.0.0.1:" + port,
                                new UploadRequest("c", "e", "h", "t", "{}"),
                                "tok",
                                "pw",
                                "r",
                                null);
                throw new AssertionError("expected 401");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.TOKEN_CONSUMED) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testPropose409() throws Exception {
        HttpServer srv =
                mockProposeServer(
                        409, "{\"error\":\"local mismatch\",\"code\":\"OLD_HASH_MISMATCH\"}");
        try {
            int port = srv.getAddress().getPort();
            try {
                new GatewayClient()
                        .proposeModification(
                                "http://127.0.0.1:" + port,
                                new UploadRequest("c", "e", "h", "t", "{}"),
                                "tok",
                                "pw",
                                "r",
                                null);
                throw new AssertionError("expected 409");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.DUPLICATE) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testPropose503() throws Exception {
        HttpServer srv = mockProposeServer(503, "{\"error\":\"no chain\"}");
        try {
            int port = srv.getAddress().getPort();
            try {
                new GatewayClient()
                        .proposeModification(
                                "http://127.0.0.1:" + port,
                                new UploadRequest("c", "e", "h", "t", "{}"),
                                "tok",
                                "pw",
                                "r",
                                null);
                throw new AssertionError("expected 503");
            } catch (GatewayUploadException e) {
                if (e.getKind() != GatewayUploadException.Kind.CHAIN_UNAVAILABLE) {
                    throw new AssertionError("kind " + e.getKind());
                }
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testCaseExistsTrue() throws Exception {
        HttpServer srv = mockCaseExistsServer(200, "{\"caseId\":\"X\",\"exists\":true,\"indexHash\":\"0xab\"}");
        try {
            int port = srv.getAddress().getPort();
            boolean ex =
                    new GatewayClient().caseExists("http://127.0.0.1:" + port, "X", "tok");
            if (!ex) {
                throw new AssertionError("expected exists");
            }
        } finally {
            srv.stop(0);
        }
    }

    private static void testCaseExistsFalse() throws Exception {
        HttpServer srv = mockCaseExistsServer(200, "{\"caseId\":\"Y\",\"exists\":false,\"indexHash\":null}");
        try {
            int port = srv.getAddress().getPort();
            boolean ex =
                    new GatewayClient().caseExists("http://127.0.0.1:" + port, "Y", "tok");
            if (ex) {
                throw new AssertionError("expected !exists");
            }
        } finally {
            srv.stop(0);
        }
    }

    private static HttpServer mockProposeServer(int status, String jsonBody) throws IOException {
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] b = jsonBody.getBytes(StandardCharsets.UTF_8);
        srv.createContext(
                "/api/modify/propose-with-token",
                ex -> {
                    ex.getRequestBody().readAllBytes();
                    ex.getResponseHeaders().add("Content-Type", "application/json");
                    ex.sendResponseHeaders(status, b.length);
                    try (OutputStream os = ex.getResponseBody()) {
                        os.write(b);
                    }
                });
        srv.setExecutor(null);
        srv.start();
        return srv;
    }

    private static HttpServer mockCaseExistsServer(int status, String jsonBody) throws IOException {
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] b = jsonBody.getBytes(StandardCharsets.UTF_8);
        srv.createContext(
                "/",
                ex -> {
                    String p = ex.getRequestURI().getPath();
                    if (!p.startsWith("/api/case-exists/")) {
                        ex.sendResponseHeaders(404, -1);
                        return;
                    }
                    ex.getRequestBody().readAllBytes();
                    ex.getResponseHeaders().add("Content-Type", "application/json");
                    ex.sendResponseHeaders(status, b.length);
                    try (OutputStream os = ex.getResponseBody()) {
                        os.write(b);
                    }
                });
        srv.setExecutor(null);
        srv.start();
        return srv;
    }

    private static HttpServer mockUploadServer(int status, String jsonBody) throws IOException {
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] b = jsonBody.getBytes(StandardCharsets.UTF_8);
        srv.createContext(
                "/api/upload",
                ex -> {
                    ex.getRequestBody().readAllBytes();
                    ex.getResponseHeaders().add("Content-Type", "application/json");
                    ex.sendResponseHeaders(status, b.length);
                    try (OutputStream os = ex.getResponseBody()) {
                        os.write(b);
                    }
                });
        srv.setExecutor(null);
        srv.start();
        return srv;
    }

    private static void assertEq(String a, Object b) {
        if (b == null && a == null) {
            return;
        }
        if (a == null || !a.equals(b)) {
            throw new AssertionError("expected <" + a + "> got <" + b + ">");
        }
    }

    private static void assertEq(long a, long b) {
        if (a != b) {
            throw new AssertionError("expected " + a + " got " + b);
        }
    }
}
