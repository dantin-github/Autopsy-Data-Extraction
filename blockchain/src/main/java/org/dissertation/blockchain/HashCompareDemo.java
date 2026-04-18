package org.dissertation.blockchain;

/**
 * Cross-check helper: same string as Node {@code hashOnly.computeIndexHash} (SHA-256 UTF-8 hex).
 * Run: HASH_COMPARE_INPUT="your text" mvn -q -P hash-compare exec:java
 * (Profile overrides default exec mainClass in pom.xml; -Dexec.mainClass alone may not.)
 */
public final class HashCompareDemo {

    private HashCompareDemo() {}

    public static void main(String[] args) throws Exception {
        String s = System.getenv("HASH_COMPARE_INPUT");
        if (s == null || s.isEmpty()) {
            s = args.length > 0 ? String.join(" ", args) : "digital forensics";
        }
        String hash = HashOnlyRecord.computeIndexHash(s);
        System.out.println("INPUT=" + s);
        System.out.println("JAVA_INDEX_HASH=" + hash);
    }
}
