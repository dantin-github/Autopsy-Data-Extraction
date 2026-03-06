import java.util.zip.*;
import java.nio.file.*;
public class Crc32 { public static void main(String[] a) throws Exception {
    CRC32 c = new CRC32();
    c.update(Files.readAllBytes(Paths.get("install-config/org-sleuthkit-autopsy-report-caseextract.xml")));
    System.out.println(c.getValue());
}}
