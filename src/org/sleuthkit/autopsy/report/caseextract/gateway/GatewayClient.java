package org.sleuthkit.autopsy.report.caseextract.gateway;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Minimal HTTP client for api-gateway: {@code POST /api/upload}, {@code GET /health}.
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
        if (authToken == null || authToken.isBlank()) {
            throw new GatewayUploadException(
                    GatewayUploadException.Kind.BAD_REQUEST,
                    0,
                    "auth token is required",
                    null,
                    null);
        }
        UploadRequest payload =
                signingPassword != null && !signingPassword.isEmpty()
                        ? request.withSigningPassword(signingPassword)
                        : request;
        byte[] body = payload.toJson().getBytes(StandardCharsets.UTF_8);
        String url = joinUrl(baseUrl, "/api/upload");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
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
            try (OutputStream out = c.getOutputStream()) {
                out.write(body);
            }
            int code = c.getResponseCode();
            String respBody = readResponseBody(c);
            if (code >= 200 && code < 300) {
                return UploadResponse.fromJson(respBody);
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
