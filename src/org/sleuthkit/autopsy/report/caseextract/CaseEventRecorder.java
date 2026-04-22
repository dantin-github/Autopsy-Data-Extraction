package org.sleuthkit.autopsy.report.caseextract;

import java.beans.PropertyChangeEvent;
import java.beans.PropertyChangeListener;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.sleuthkit.autopsy.casemodule.Case;
import org.sleuthkit.datamodel.Content;
import org.sleuthkit.datamodel.Image;
import org.sleuthkit.datamodel.TskCoreException;

/**
 * Records case-related events (operation log) and persists them to the case directory.
 * Registers a Case event listener on module load, writing operation type, timestamp,
 * and current examiner to a JSON file.
 */
public final class CaseEventRecorder {

    private static final Logger LOGGER = Logger.getLogger(CaseEventRecorder.class.getName());
    private static final String EVENTS_FILENAME = "case_extract_events.json";
    private static final String REPORT_DIR = "CaseDataExtract";
    private static final String REPORT_FILENAME = "case_data_extract.json";

    // ---------------------------------------------------------------
    // Integrity check result for one image data source
    // ---------------------------------------------------------------
    public static final class ImageIntegrityResult {
        /** Human-readable name of the data source. */
        public final String imageName;
        /** Physical file paths on disk. */
        public final String[] imagePaths;
        /** MD5 stored by Autopsy in its database when the image was imported. */
        public volatile String dbMd5 = "";
        /** SHA-256 stored by Autopsy in its database when the image was imported. */
        public volatile String dbSha256 = "";
        /** SHA-256 recorded in the last exported case_data_extract.json report. */
        public volatile String reportSha256 = "";
        /** SHA-256 freshly computed by reading the physical file bytes (may take time). */
        public volatile String fileSha256 = "";
        /** Bytes already processed during the file-hash computation. */
        public volatile long bytesProcessed = 0;
        /** Total bytes to process (sum of all physical file sizes). */
        public volatile long totalBytes = 1;
        /**
         * Current status string, e.g.
         * "Checking… 45%", "OK — integrity verified", "TAMPERED — hash mismatch!"
         */
        public volatile String status = "Pending";

        ImageIntegrityResult(String imageName, String[] imagePaths) {
            this.imageName = imageName;
            this.imagePaths = imagePaths != null ? imagePaths : new String[0];
        }

        /** Returns true once the background hash computation has finished (or errored). */
        public boolean isDone() {
            return !status.startsWith("Checking") && !status.equals("Pending");
        }
    }

    // ---------------------------------------------------------------
    // Fields
    // ---------------------------------------------------------------
    private static volatile CaseEventRecorder instance;
    private final List<OperationEntry> events = new CopyOnWriteArrayList<>();
    private volatile boolean listenerRegistered;
    private volatile String lastError;
    private volatile long lastWriteTimeMs;
    private volatile String currentCaseDir;

    /** Integrity check results – one entry per Image data source. */
    private final List<ImageIntegrityResult> integrityResults = new CopyOnWriteArrayList<>();
    private volatile Thread integrityThread;

    public static CaseEventRecorder getInstance() {
        if (instance == null) {
            synchronized (CaseEventRecorder.class) {
                if (instance == null) {
                    instance = new CaseEventRecorder();
                }
            }
        }
        return instance;
    }

    private CaseEventRecorder() {
        registerListenerIfNeeded();
    }

    private void registerListenerIfNeeded() {
        if (listenerRegistered) {
            return;
        }
        try {
            Case.addEventTypeSubscriber(EnumSet.of(
                    Case.Events.CURRENT_CASE,
                    Case.Events.DATA_SOURCE_ADDED,
                    Case.Events.DATA_SOURCE_DELETED,
                    Case.Events.REPORT_ADDED,
                    Case.Events.CASE_DETAILS,
                    Case.Events.ADDING_DATA_SOURCE,
                    Case.Events.ADDING_DATA_SOURCE_FAILED
            ), new CaseEventListener());
            listenerRegistered = true;
            lastError = null;
            LOGGER.log(Level.INFO, "CaseEventRecorder: listener registered");
        } catch (Exception e) {
            lastError = e.getMessage();
            LOGGER.log(Level.WARNING, "CaseEventRecorder: failed to register listener", e);
        }

        // If a case was already open before this recorder was instantiated (e.g. Autopsy
        // auto-restored the last case on startup), we will have missed the CURRENT_CASE
        // event entirely.  Catch up by calling onCaseOpened() right now.
        if (currentCaseDir == null) {
            try {
                Case already = Case.getCurrentCase();
                if (already != null) {
                    String dir = already.getCaseDirectory();
                    if (dir != null && !dir.isEmpty()) {
                        LOGGER.log(Level.INFO, "CaseEventRecorder: catching up with already-open case {0}", dir);
                        onCaseOpened(dir, already);
                    }
                }
            } catch (Exception ignored) {
                // No case open yet – nothing to catch up on
            }
        }
    }

    private final class CaseEventListener implements PropertyChangeListener {
        @Override
        public void propertyChange(PropertyChangeEvent evt) {
            String propName = evt.getPropertyName();
            Object newVal = evt.getNewValue();

            if (Case.Events.CURRENT_CASE.name().equals(propName)) {
                if (newVal instanceof Case) {
                    // Case opened: read info directly from the event object (no race condition)
                    Case openedCase = (Case) newVal;
                    String dir = openedCase.getCaseDirectory();
                    if (dir != null) {
                        onCaseOpened(dir, openedCase);
                    }
                } else if (newVal == null && evt.getOldValue() instanceof Case) {
                    // Case closed: record close before clearing state
                    Case closedCase = (Case) evt.getOldValue();
                    String examiner = closedCase.getExaminer() != null ? closedCase.getExaminer() : "";
                    String caseName = closedCase.getDisplayName() != null ? closedCase.getDisplayName() : "";
                    events.add(new OperationEntry(System.currentTimeMillis(),
                            "CASE_CLOSED", examiner, caseName));
                    persistToCaseDirectory();
                    onCaseClosed();
                }
                return; // CURRENT_CASE is fully handled above; skip generic addEvent
            }

            // All other events: get examiner from current case
            String examiner = "";
            try {
                Case c = Case.getCurrentCase();
                if (c != null) {
                    examiner = c.getExaminer() != null ? c.getExaminer() : "";
                }
            } catch (Exception ignored) {
            }
            String detail = "";
            if (newVal != null) {
                detail = (newVal instanceof Content) ? ((Content) newVal).getName() : newVal.toString();
            }
            addEvent(propName, examiner, detail);
        }
    }

    /** Appends one row to the in-memory log and {@code case_extract_events.json} under the open case (Phase 4 S4.6). */
    public void addEvent(String operationType, String operator, String detail) {
        events.add(new OperationEntry(System.currentTimeMillis(), operationType, operator, detail));
        persistToCaseDirectory();
    }

    private void persistToCaseDirectory() {
        // Use the already-known case directory — never call Case.getCurrentCaseThrows()
        // here, because this method is also called during case-open/close transitions
        // when Autopsy's internal current-case state may not yet be consistent.
        String dir = currentCaseDir;
        if (dir == null || dir.isEmpty()) {
            return;
        }
        File out = new File(dir, EVENTS_FILENAME);
        try (FileWriter w = new FileWriter(out, StandardCharsets.UTF_8)) {
            w.write(OperationEntry.toJsonArray(events));
            lastWriteTimeMs = System.currentTimeMillis();
            lastError = null;
        } catch (IOException e) {
            lastError = e.getMessage();
            LOGGER.log(Level.WARNING, "CaseEventRecorder: persist failed", e);
        }
    }

    /**
     * Called when a case is opened. Loads the existing log for this case, then
     * appends a CASE_OPENED entry (with examiner read directly from the Case object
     * provided by the event, avoiding any getCurrentCase() race condition).
     * Also triggers the background image-integrity check.
     */
    void onCaseOpened(String caseDirectory, Case openedCase) {
        currentCaseDir = caseDirectory;
        events.clear();
        loadFromCaseDirectory(caseDirectory);

        String examiner = "";
        if (openedCase != null && openedCase.getExaminer() != null && !openedCase.getExaminer().isEmpty()) {
            examiner = openedCase.getExaminer();
        } else {
            examiner = System.getProperty("user.name", "");
        }

        String caseName = (openedCase != null && openedCase.getDisplayName() != null)
                ? openedCase.getDisplayName() : caseDirectory;
        String detail = caseName + " | OS user: " + System.getProperty("user.name", "");

        events.add(new OperationEntry(System.currentTimeMillis(), "CASE_OPENED", examiner, detail));
        persistToCaseDirectory();

        // Start image integrity check in background
        startIntegrityCheck(openedCase, caseDirectory);
    }

    void onCaseClosed() {
        currentCaseDir = null;
        events.clear();
    }

    private void loadFromCaseDirectory(String caseDir) {
        File f = new File(caseDir, EVENTS_FILENAME);
        if (!f.isFile()) {
            return;
        }
        try (FileReader r = new FileReader(f, StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) > 0) {
                sb.append(buf, 0, n);
            }
            List<OperationEntry> loaded = OperationEntry.fromJsonArray(sb.toString());
            events.clear();
            events.addAll(loaded);
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "CaseEventRecorder: load failed", e);
        }
    }

    // --- Used by the status window and report module ---

    public boolean isRunningNormal() {
        return listenerRegistered && lastError == null;
    }

    public String getLastError() {
        return lastError;
    }

    public long getLastWriteTimeMs() {
        return lastWriteTimeMs;
    }

    public String getCurrentCaseDirectory() {
        return currentCaseDir;
    }

    public boolean hasOpenCase() {
        try {
            return Case.getCurrentCaseThrows() != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** Number of operations currently in memory (including those loaded from file). */
    public int getEventCount() {
        return events.size();
    }

    /** Returns the most recent N operations for display in the status window. */
    public List<OperationEntry> getRecentEvents(int maxCount) {
        int size = events.size();
        if (size == 0) {
            return Collections.emptyList();
        }
        int from = Math.max(0, size - maxCount);
        List<OperationEntry> sub = new ArrayList<>(events.subList(from, size));
        Collections.reverse(sub);
        return sub;
    }

    public List<OperationEntry> getAllEvents() {
        return new ArrayList<>(events);
    }

    /** Returns the live integrity-check results (one per Image data source). */
    public List<ImageIntegrityResult> getIntegrityResults() {
        return Collections.unmodifiableList(integrityResults);
    }

    // ---------------------------------------------------------------
    // Integrity check implementation
    // ---------------------------------------------------------------

    private void startIntegrityCheck(Case openedCase, String caseDirectory) {
        // Cancel any running check from a previous case
        if (integrityThread != null) {
            integrityThread.interrupt();
        }
        integrityResults.clear();

        if (openedCase == null) return;

        // Collect Image data sources
        List<Content> dataSources;
        try {
            dataSources = openedCase.getDataSources();
        } catch (TskCoreException e) {
            LOGGER.log(Level.WARNING, "IntegrityCheck: getDataSources failed", e);
            return;
        }

        // Load reference hashes from the most-recently-generated report (if any)
        Map<String, String> reportHashes = loadLastReportHashes(caseDirectory);

        for (Content ds : dataSources) {
            if (!(ds instanceof Image)) continue;
            Image img = (Image) ds;
            String name = img.getName() != null ? img.getName() : "(unknown)";
            String[] paths = img.getPaths();

            ImageIntegrityResult r = new ImageIntegrityResult(name, paths);

            // DB-stored hashes (computed by Autopsy when the image was first imported)
            try {
                r.dbMd5    = img.getMd5()    != null ? img.getMd5()    : "";
                r.dbSha256 = img.getSha256() != null ? img.getSha256() : "";
            } catch (TskCoreException ignored) {}

            // Reference SHA-256 from the last exported report (keyed by image name)
            r.reportSha256 = reportHashes.getOrDefault(name, "");

            // Compute total file size for progress reporting
            for (String p : r.imagePaths) {
                File f = new File(p);
                if (f.isFile()) r.totalBytes += f.length();
            }
            if (r.totalBytes < 1) r.totalBytes = 1;

            r.status = "Checking...";
            integrityResults.add(r);
        }

        if (integrityResults.isEmpty()) return;

        integrityThread = new Thread(() -> {
            for (ImageIntegrityResult r : integrityResults) {
                if (Thread.currentThread().isInterrupted()) {
                    r.status = "Cancelled";
                    break;
                }
                computeFileHash(r);
            }
        }, "CaseDataExtract-IntegrityCheck");
        integrityThread.setDaemon(true);
        integrityThread.start();
    }

    /**
     * Reads every physical image file byte-by-byte and computes MD5 + SHA-256.
     * Updates {@code r.status} and {@code r.fileSha256} when done.
     * Runs on the background integrity-check thread.
     */
    private void computeFileHash(ImageIntegrityResult r) {
        if (r.imagePaths.length == 0) {
            r.status = "No file path recorded";
            return;
        }

        MessageDigest md5Digest, sha256Digest;
        try {
            md5Digest    = MessageDigest.getInstance("MD5");
            sha256Digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            r.status = "Error: hash algorithm unavailable";
            return;
        }

        byte[] buf = new byte[65536]; // 64 KB read buffer
        for (String path : r.imagePaths) {
            File f = new File(path);
            if (!f.isFile()) {
                r.status = "Error: file not found — " + path;
                return;
            }
            try (FileInputStream fis = new FileInputStream(f)) {
                int n;
                while ((n = fis.read(buf)) > 0) {
                    if (Thread.currentThread().isInterrupted()) {
                        r.status = "Cancelled";
                        return;
                    }
                    md5Digest.update(buf, 0, n);
                    sha256Digest.update(buf, 0, n);
                    r.bytesProcessed += n;
                    long pct = r.bytesProcessed * 100 / r.totalBytes;
                    r.status = "Checking... " + pct + "%";
                }
            } catch (IOException e) {
                r.status = "Error reading file: " + e.getMessage();
                return;
            }
        }

        String md5Hex    = toHex(md5Digest.digest());
        String sha256Hex = toHex(sha256Digest.digest());
        r.fileSha256 = sha256Hex;

        // Compare file hash against the reference hash from the last report,
        // or against the DB-stored hash if no report is available.
        String reference = !r.reportSha256.isEmpty() ? r.reportSha256 : r.dbSha256;
        boolean hasReference = !reference.isEmpty();

        if (!hasReference) {
            r.status = "No reference hash — first run or no report generated yet";
        } else if (reference.equalsIgnoreCase(sha256Hex)) {
            r.status = "OK — integrity verified";
        } else {
            r.status = "TAMPERED — hash mismatch! Image file may have been modified.";
            // Record the event in the operation log for audit purposes
            String detail = r.imageName + " | expected=" + reference.substring(0, 16)
                    + "… | actual=" + sha256Hex.substring(0, 16) + "…";
            addEvent("INTEGRITY_FAIL", System.getProperty("user.name", ""), detail);
        }
    }

    /**
     * Searches for the most recent case_data_extract.json inside the case's
     * Reports folder and extracts the SHA-256 hash recorded for each data source.
     *
     * @return Map of image name → sha256 value
     */
    private static Map<String, String> loadLastReportHashes(String caseDirectory) {
        Map<String, String> result = new HashMap<>();
        File reportsDir = new File(caseDirectory, "Reports");
        if (!reportsDir.isDirectory()) return result;

        File[] subDirs = reportsDir.listFiles(File::isDirectory);
        if (subDirs == null || subDirs.length == 0) return result;

        // Most-recently-modified directory first
        Arrays.sort(subDirs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));

        for (File dir : subDirs) {
            File json = new File(dir, REPORT_DIR + File.separator + REPORT_FILENAME);
            if (json.isFile()) {
                parseDataSourceHashes(json, result);
                if (!result.isEmpty()) break; // found a valid report
            }
        }
        return result;
    }

    /**
     * Parses the "dataSources" array in a case_data_extract.json and fills the map
     * with image name → sha256.  Uses simple string scanning to avoid external libs.
     */
    private static void parseDataSourceHashes(File jsonFile, Map<String, String> out) {
        try (FileReader r = new FileReader(jsonFile, StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            String json = sb.toString();

            // Find "dataSources" array
            int dsIdx = json.indexOf("\"dataSources\"");
            if (dsIdx < 0) return;
            int arrStart = json.indexOf('[', dsIdx);
            if (arrStart < 0) return;

            // Walk through each object in the array
            int i = arrStart + 1;
            while (i < json.length()) {
                int objStart = json.indexOf('{', i);
                if (objStart < 0) break;
                int objEnd = findMatchingBrace(json, objStart);
                if (objEnd < 0) break;
                String obj = json.substring(objStart, objEnd + 1);

                String name   = extractQuoted(obj, "name");
                String sha256 = extractQuoted(obj, "sha256");
                if (!name.isEmpty() && !sha256.isEmpty()) {
                    out.put(name, sha256);
                }
                i = objEnd + 1;
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "IntegrityCheck: failed to parse report hashes", e);
        }
    }

    private static int findMatchingBrace(String s, int from) {
        int depth = 0;
        for (int i = from; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') { if (--depth == 0) return i; }
        }
        return -1;
    }

    private static String extractQuoted(String obj, String key) {
        String search = "\"" + key + "\":\"";
        int idx = obj.indexOf(search);
        if (idx < 0) return "";
        idx += search.length();
        StringBuilder sb = new StringBuilder();
        for (int i = idx; i < obj.length(); i++) {
            char c = obj.charAt(i);
            if (c == '\\' && i + 1 < obj.length()) { sb.append(obj.charAt(++i)); }
            else if (c == '"') break;
            else sb.append(c);
        }
        return sb.toString();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return sb.toString();
    }

    // ---------------------------------------------------------------

    /** Reads the persisted operation log from the case directory (used during report generation). */
    public static List<OperationEntry> loadEventsFromCaseDirectory(String caseDirectory) {
        File f = new File(caseDirectory, EVENTS_FILENAME);
        if (!f.isFile()) {
            return Collections.emptyList();
        }
        try (FileReader r = new FileReader(f, StandardCharsets.UTF_8)) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) > 0) {
                sb.append(buf, 0, n);
            }
            return OperationEntry.fromJsonArray(sb.toString());
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    public static final class OperationEntry {
        private final long timeMs;
        private final String operationType;
        private final String operator;
        private final String detail;

        public OperationEntry(long timeMs, String operationType, String operator, String detail) {
            this.timeMs = timeMs;
            this.operationType = operationType == null ? "" : operationType;
            this.operator = operator == null ? "" : operator;
            this.detail = detail == null ? "" : detail;
        }

        public long getTimeMs() {
            return timeMs;
        }

        public String getOperationType() {
            return operationType;
        }

        public String getOperator() {
            return operator;
        }

        public String getDetail() {
            return detail;
        }

        public String getTimeFormatted() {
            return DateTimeFormatter.ISO_OFFSET_DATE_TIME
                    .withZone(ZoneId.systemDefault())
                    .format(Instant.ofEpochMilli(timeMs));
        }

        static String toJsonArray(List<OperationEntry> list) {
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) sb.append(",");
                OperationEntry e = list.get(i);
                sb.append("{")
                        .append("\"timeMs\":").append(e.timeMs).append(",")
                        .append("\"operationType\":\"").append(escape(e.operationType)).append("\",")
                        .append("\"operator\":\"").append(escape(e.operator)).append("\",")
                        .append("\"detail\":\"").append(escape(e.detail)).append("\"")
                        .append("}");
            }
            sb.append("]");
            return sb.toString();
        }

        static List<OperationEntry> fromJsonArray(String json) {
            List<OperationEntry> out = new ArrayList<>();
            if (json == null || json.trim().isEmpty()) {
                return out;
            }
            String s = json.trim();
            if (!s.startsWith("[") || !s.endsWith("]")) {
                return out;
            }
            // Simple parser to avoid pulling in Gson or similar dependencies
            int i = 1;
            while (i < s.length()) {
                int start = s.indexOf('{', i);
                if (start < 0) break;
                int end = findMatchingBrace(s, start);
                if (end < 0) break;
                String obj = s.substring(start, end + 1);
                OperationEntry e = parseOne(obj);
                if (e != null) out.add(e);
                i = end + 1;
            }
            return out;
        }

        private static int findMatchingBrace(String s, int from) {
            int depth = 0;
            for (int i = from; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c == '{') depth++;
                else if (c == '}') {
                    depth--;
                    if (depth == 0) return i;
                }
            }
            return -1;
        }

        private static OperationEntry parseOne(String obj) {
            long timeMs = 0;
            String operationType = "";
            String operator = "";
            String detail = "";
            try {
                timeMs = Long.parseLong(extractStringValue(obj, "timeMs").trim());
            } catch (Exception ignored) {
            }
            operationType = extractQuotedValue(obj, "operationType");
            operator = extractQuotedValue(obj, "operator");
            detail = extractQuotedValue(obj, "detail");
            return new OperationEntry(timeMs, operationType, operator, detail);
        }

        private static String extractStringValue(String obj, String key) {
            String search = "\"" + key + "\":";
            int idx = obj.indexOf(search);
            if (idx < 0) return "";
            idx += search.length();
            int end = obj.indexOf(",", idx);
            if (end < 0) end = obj.indexOf("}", idx);
            if (end < 0) return "";
            return obj.substring(idx, end).trim();
        }

        private static String extractQuotedValue(String obj, String key) {
            String search = "\"" + key + "\":\"";
            int idx = obj.indexOf(search);
            if (idx < 0) return "";
            idx += search.length();
            StringBuilder sb = new StringBuilder();
            for (int i = idx; i < obj.length(); i++) {
                char c = obj.charAt(i);
                if (c == '\\' && i + 1 < obj.length()) {
                    sb.append(obj.charAt(i + 1));
                    i++;
                } else if (c == '"') {
                    break;
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        private static String escape(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
        }
    }
}
