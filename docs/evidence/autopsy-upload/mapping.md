# Thesis ↔ evidence mapping (Autopsy upload & §5.4 latency)

Use this table when writing **§5.4** (or equivalent) and the **Autopsy integration** chapter. Replace placeholder figure names with your final screenshot filenames under `screens/`.

## §5.4 — Wall-clock and latency symbols

| Symbol | Definition | Primary artifact |
|--------|------------|------------------|
| **T0** | Client starts HTTP upload (immediately before `openConnection`) | `upload_receipt.json` → `uploadStartedAt` |
| **T1** | Client finished reading HTTP response (success or failure body) | `upload_receipt.json` → `uploadResponseAt`; `clientRoundTripMs` = T1 − T0 (ms) |
| **T2** | On-chain block time for the transaction | `upload_receipt.json` → `blockTimestampUtc` (when gateway provides it); cross-check WeBASE / block explorer |
| **Server breakdown** | Integrity verify + chain RPC (+ CaseRegistry) | Response / receipt → `timing.integrityMs`, `chainMs`, `caseRegistryMs`, `totalMs`; gateway structured log `upload_timing` keyed by `requestId` |

**Caveats for the thesis text:** T0–T2 use different clocks (examiner PC, gateway host, chain node). State **NTP / skew** limitations when arguing sub-second precision.

## Narrative claims → evidence

| Claim | Evidence |
|--------|----------|
| Autopsy can submit the case export to the gateway after report generation | Root `README.md` mermaid (Autopsy → api-gateway); `CaseDataExtractReportModule` upload path; sample receipt in `samples/` |
| Client round-trip is measurable independently of server `totalMs` | `upload_receipt.json`: `clientRoundTripMs` vs `timing.totalMs` (example: network + JVM overhead) |
| Upload outcome is visible without re-opening the case directory | **Case Data Extract Status** → **Upload Status** tab; `CaseEventRecorder.getLastUpload()` restored from latest `upload_receipt.json` on case open |
| Failed upload does not delete the local JSON report | `case_data_extract.json` still present with `uploadStatus: failed` (or `cancelled`); thesis figure: file listing + JSON snippet |
| Operator-facing error taxonomy | `GatewayUploadException.Kind`; Monitor **Error kind** row; `case_extract_events.json` `UPLOAD_FAILED` / `UPLOAD_OK` |

## Optional (S6.3 fault injection)

If you run the three fault scenarios, add:

| Scenario | Monitor / receipt | Suggested screenshot |
|----------|-------------------|----------------------|
| Gateway stopped | `GATEWAY_UNREACHABLE`, red banner | `screens/s6.3a-gateway-down-monitor.png` |
| OTP reused | `TOKEN_CONSUMED`, HTTP 401 | `screens/s6.3b-token-consumed-monitor.png` |
| Wrong signing password (Contract) | `FORBIDDEN` or `BAD_REQUEST` (gateway-dependent) | `screens/s6.3c-wrong-signing-password-monitor.png` |

If S6.3 was **not** executed, state that in the thesis (“validated on success path and automated tests; fault injection left for future work”) or run the checklist later.

## Figure checklist (minimum for upload chapter)

1. Autopsy **Generate Report** wizard with upload options (if not sensitive).
2. **Upload Status** tab showing `clientRoundTripMs`, `requestId`, and `timing` rows.
3. One **`upload_receipt.json`** (redacted) side-by-side with gateway log line containing the same `requestId`.
4. WeBASE or explorer screenshot for `txHash` / block height (optional but strengthens T2).
