package org.sleuthkit.autopsy.report.caseextract;

import org.sleuthkit.autopsy.report.caseextract.gateway.SimpleJson;

/**
 * S5.1: {@link UploadSnapshot} receipt parsing and factories.
 * Run: {@code ant test-upload-snapshot} from repo root.
 */
public final class UploadSnapshotTest {

    private UploadSnapshotTest() {
    }

    public static void main(String[] args) throws Exception {
        parseSuccessReceipt();
        parseFailureReceipt();
        fromSkipped();
        System.out.println("UploadSnapshotTest: all assertions passed.");
    }

    private static void parseSuccessReceipt() throws SimpleJson.JsonParseException {
        String json =
                "{\n"
                        + "  \"uploadStatus\": \"success\",\n"
                        + "  \"uploadStartedAt\": \"2026-04-22T02:25:59.318587700Z\",\n"
                        + "  \"uploadResponseAt\": \"2026-04-22T02:26:00.331783400Z\",\n"
                        + "  \"clientRoundTripMs\": 1013,\n"
                        + "  \"requestId\": \"8de51f6e-2b91-457f-b26c-bb7d03ed3075\",\n"
                        + "  \"timing\": {\n"
                        + "    \"integrityMs\": 5,\n"
                        + "    \"chainMs\": 337,\n"
                        + "    \"totalMs\": 978,\n"
                        + "    \"caseRegistryMs\": 542\n"
                        + "  },\n"
                        + "  \"indexHash\": \"0x4b22\",\n"
                        + "  \"recordHash\": \"0x3194\",\n"
                        + "  \"txHash\": \"0xce07\",\n"
                        + "  \"blockNumber\": 960,\n"
                        + "  \"caseRegistryTxHash\": \"0xe08f\",\n"
                        + "  \"caseRegistryBlockNumber\": 961\n"
                        + "}\n";
        UploadSnapshot s = UploadSnapshot.fromReceiptJson(json, "4", 1L);
        if (!"success".equals(s.getStatus())) {
            throw new AssertionError("status");
        }
        if (!"4".equals(s.getCaseId())) {
            throw new AssertionError("caseId");
        }
        if (s.getClientRoundTripMs() != 1013) {
            throw new AssertionError("rtt");
        }
        if (!"0xce07".equals(s.getTxHash())) {
            throw new AssertionError("tx");
        }
        if (s.getBlockNumber() == null || s.getBlockNumber() != 960) {
            throw new AssertionError("block");
        }
        if (s.getTiming() == null || s.getTiming().getTotalMs() != 978) {
            throw new AssertionError("timing");
        }
        if (!s.getTiming().hasCaseRegistryMs() || s.getTiming().getCaseRegistryMs() != 542) {
            throw new AssertionError("caseRegistryMs");
        }
    }

    private static void parseFailureReceipt() throws SimpleJson.JsonParseException {
        String json =
                "{\n"
                        + "  \"uploadStatus\": \"failed\",\n"
                        + "  \"uploadStartedAt\": \"2026-04-22T01:00:00Z\",\n"
                        + "  \"uploadResponseAt\": \"2026-04-22T01:00:01Z\",\n"
                        + "  \"clientRoundTripMs\": 100,\n"
                        + "  \"errorKind\": \"GATEWAY_UNREACHABLE\",\n"
                        + "  \"httpStatus\": 0,\n"
                        + "  \"errorMessage\": \"unreachable\"\n"
                        + "}\n";
        UploadSnapshot s = UploadSnapshot.fromReceiptJson(json, "1", 2L);
        if (!"failed".equals(s.getStatus()) || !"GATEWAY_UNREACHABLE".equals(s.getErrorKind())) {
            throw new AssertionError("failed");
        }
    }

    private static void fromSkipped() {
        UploadSnapshot s = UploadSnapshot.fromSkipped("2", "missing_token");
        if (!"skipped".equals(s.getStatus()) || !"missing_token".equals(s.getErrorMessage())) {
            throw new AssertionError("skipped");
        }
    }
}
