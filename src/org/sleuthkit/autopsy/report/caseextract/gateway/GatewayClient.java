package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/**
 * Minimal HTTP client for api-gateway: {@code POST /api/upload}, {@code POST /api/modify/propose-with-token},
 * {@code GET /api/case-exists/:caseId}, {@code GET /health}.
 * Phase 4 S4.7: optional {@link UploadClientTiming} records wall-clock RTT from just before {@code openConnection()}
 * through response body read (or failure), for receipt / §5.4.
 */
public final class GatewayClient {

    public static final String USER_AGENT = "case-data-extract/1.0";

    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    public UploadResponse uploadCase(
            String baseUrl,
            UploadRequest request,
            String authToken,
            String signingPassword,
            boolean debugTiming)
            throws GatewayUploadException {
        return uploadCase(baseUrl, request, authToken, signingPassword, debugTiming, null, null, null);
    }

    public UploadResponse uploadCase(
            String baseUrl,
            UploadRequest request,
            String authToken,
            String signingPassword,
            boolean debugTiming,
            AtomicReference<HttpURLConnection> connectionHolder,
            BooleanSupplier cancelRequested)
            throws GatewayUploadException {
        return uploadCase(
                baseUrl, request, authToken, signingPassword, debugTiming, connectionHolder, cancelRequested, null);
    }

    /**
     * @param connectionHolder if non-null, set to the open {@link HttpURLConnection} until closed (for
     *     {@link HttpURLConnection#disconnect()} on user cancel)
     * @param cancelRequested if non-null and returns true, aborts with {@link GatewayUploadException.Kind#CANCELLED}
     * @param clientTiming if non-null, {@link UploadClientTiming#markHttpRequestStarted()} runs immediately before
     *     {@code openConnection()}; {@link UploadClientTiming#finishHttpAttempt()} always runs in {@code finally}
     */
    public UploadResponse uploadCase(
            String baseUrl,
            UploadRequest request,
            String authToken,
            String signingPassword,
            boolean debugTiming,
            AtomicReference<HttpURLConnection> connectionHolder,
            BooleanSupplier cancelRequested,
            UploadClientTiming clientTiming)
            throws GatewayUploadException {
        HttpURLConnection c = null;
        try {
            if (authToken == null || authToken.isBlank()) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.BAD_REQUEST,
                        0,
                        "auth token is required",
                        null,
                        null);
            }
            throwIfCancelled(cancelRequested);
            UploadRequest payload =
                    signingPassword != null && !signingPassword.isEmpty()
                            ? request.withSigningPassword(signingPassword)
                            : request;
            byte[] body = payload.toJson().getBytes(StandardCharsets.UTF_8);
            String url = joinUrl(baseUrl, "/api/upload");
            if (clientTiming != null) {
                clientTiming.markHttpRequestStarted();
            }
            c = (HttpURLConnection) new URL(url).openConnection();
            if (connectionHolder != null) {
                connectionHolder.set(c);
            }
            c.setRequestMethod("POST");
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", USER_AGENT);
            c.setRequestProperty("X-Auth-Token", authToken.trim());
            if (debugTiming) {
                c.setRequestProperty("X-Debug-Timing", "1");
            }
            throwIfCancelled(cancelRequested);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body);
            }
            throwIfCancelled(cancelRequested);
            int code = c.getResponseCode();
            String respBody = readResponseBody(c);
            if (code >= 200 && code < 300) {
                return UploadResponse.fromJson(respBody);
            }
            throw GatewayUploadException.fromHttpResponse(code, respBody);
        } catch (SocketTimeoutException e) {
            if (isCancelled(cancelRequested)) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.CANCELLED,
                        0,
                        "cancelled",
                        null,
                        e);
            }
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.TIMEOUT,
                    0,
                    e.getMessage() != null ? e.getMessage() : "timeout",
                    null,
                    e);
        } catch (IOException e) {
            if (isCancelled(cancelRequested)) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.CANCELLED,
                        0,
                        "cancelled",
                        null,
                        e);
            }
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.GATEWAY_UNREACHABLE,
                    0,
                    "unreachable: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()),
                    null,
                    e);
        } catch (GatewayUploadException e) {
            throw e;
        } finally {
            if (clientTiming != null) {
                clientTiming.finishHttpAttempt();
            }
            if (connectionHolder != null) {
                connectionHolder.set(null);
            }
            if (c != null) {
                c.disconnect();
            }
        }
    }

    private static void throwIfCancelled(BooleanSupplier cancelRequested) throws GatewayUploadException {
        if (isCancelled(cancelRequested)) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.CANCELLED, 0, "cancelled", null, null);
        }
    }

    private static boolean isCancelled(BooleanSupplier cancelRequested) {
        return cancelRequested != null && cancelRequested.getAsBoolean();
    }

    /**
     * POST /api/modify/propose-with-token — police OTP + keystore signing + reason (P3).
     */
    public ProposalResponse proposeModification(
            String baseUrl,
            UploadRequest request,
            String authToken,
            String signingPassword,
            String reason,
            UploadClientTiming clientTiming)
            throws GatewayUploadException {
        HttpURLConnection c = null;
        try {
            if (authToken == null || authToken.isBlank()) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.BAD_REQUEST,
                        0,
                        "auth token is required",
                        null,
                        null);
            }
            String sp = signingPassword != null ? signingPassword : "";
            byte[] body =
                    request.toProposeJson(sp, reason != null ? reason : "").getBytes(StandardCharsets.UTF_8);
            String url = joinUrl(baseUrl, "/api/modify/propose-with-token");
            if (clientTiming != null) {
                clientTiming.markHttpRequestStarted();
            }
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", USER_AGENT);
            c.setRequestProperty("X-Auth-Token", authToken.trim());
            try (OutputStream out = c.getOutputStream()) {
                out.write(body);
            }
            int code = c.getResponseCode();
            String respBody = readResponseBody(c);
            if (code >= 200 && code < 300) {
                return ProposalResponse.fromJson(respBody);
            }
            throw GatewayUploadException.fromHttpResponse(code, respBody);
        } catch (SocketTimeoutException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.TIMEOUT,
                    0,
                    e.getMessage() != null ? e.getMessage() : "timeout",
                    null,
                    e);
        } catch (IOException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.GATEWAY_UNREACHABLE,
                    0,
                    "unreachable: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()),
                    null,
                    e);
        } catch (GatewayUploadException e) {
            throw e;
        } finally {
            if (clientTiming != null) {
                clientTiming.finishHttpAttempt();
            }
            if (c != null) {
                c.disconnect();
            }
        }
    }

    /**
     * GET /api/case-exists/:caseId — returns registry {@code exists} flag (peek token).
     */
    public boolean caseExists(String baseUrl, String caseId, String authToken) throws GatewayUploadException {
        HttpURLConnection c = null;
        try {
            if (authToken == null || authToken.isBlank()) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.BAD_REQUEST,
                        0,
                        "auth token is required",
                        null,
                        null);
            }
            if (caseId == null || caseId.isBlank()) {
                throw new GatewayUploadException(
                        GatewayUploadException.Kind.BAD_REQUEST, 0, "caseId is required", null, null);
            }
            String enc =
                    URLEncoder.encode(caseId.trim(), StandardCharsets.UTF_8).replace("+", "%20");
            String url = joinUrl(baseUrl, "/api/case-exists/" + enc);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", USER_AGENT);
            c.setRequestProperty("X-Auth-Token", authToken.trim());
            int code = c.getResponseCode();
            String respBody = readResponseBody(c);
            if (code >= 200 && code < 300) {
                try {
                    Map<String, Object> m = SimpleJson.parseObject(respBody.trim());
                    Object ex = m.get("exists");
                    if (ex instanceof Boolean) {
                        return (Boolean) ex;
                    }
                    throw new GatewayUploadException(
                            GatewayUploadException.Kind.UNKNOWN,
                            0,
                            "case-exists response missing boolean exists",
                            null,
                            null);
                } catch (SimpleJson.JsonParseException e) {
                    throw new GatewayUploadException(
                            GatewayUploadException.Kind.UNKNOWN,
                            0,
                            "invalid JSON: " + e.getMessage(),
                            null,
                            null);
                }
            }
            throw GatewayUploadException.fromHttpResponse(code, respBody);
        } catch (SocketTimeoutException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.TIMEOUT,
                    0,
                    e.getMessage() != null ? e.getMessage() : "timeout",
                    null,
                    e);
        } catch (IOException e) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.GATEWAY_UNREACHABLE,
                    0,
                    "unreachable: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()),
                    null,
                    e);
        } catch (GatewayUploadException e) {
            throw e;
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    /**
     * GET /health — latency is round-trip until response body is fully read.
     */
    public PingResult ping(String baseUrl) {
        long t0 = System.nanoTime();
        String url = joinUrl(baseUrl, "/health");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", USER_AGENT);
            int code = c.getResponseCode();
            String body = readResponseBody(c);
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            if (code == 200
                    && body != null
                    && body.contains("\"status\"")
                    && body.toLowerCase().contains("ok")) {
                return new PingResult(true, ms, "OK");
            }
            return new PingResult(false, ms, "HTTP " + code);
        } catch (SocketTimeoutException e) {
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            return new PingResult(false, ms, "Timeout: " + (e.getMessage() != null ? e.getMessage() : ""));
        } catch (IOException e) {
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            return new PingResult(
                    false,
                    ms,
                    "unreachable: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    static String joinUrl(String baseUrl, String path) {
        if (baseUrl == null) {
            return path;
        }
        String b = baseUrl.trim();
        while (b.endsWith("/")) {
            b = b.substring(0, b.length() - 1);
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        return b + path;
    }

    private static String readResponseBody(HttpURLConnection c) throws IOException {
        InputStream in = c.getErrorStream() != null ? c.getErrorStream() : c.getInputStream();
        if (in == null) {
            return "";
        }
        try (InputStream stream = in;
                ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
            stream.transferTo(buf);
            return buf.toString(StandardCharsets.UTF_8);
        }
    }
}
