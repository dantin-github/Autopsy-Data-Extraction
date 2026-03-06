import java.util.zip.*;
import java.nio.file.*;
public class C { public static void main(String[] a) throws Exception {
  CRC32 c = new CRC32();
  c.update(Files.readAllBytes(Paths.get(a[0])));
  System.out.println(c.getValue());
}}
