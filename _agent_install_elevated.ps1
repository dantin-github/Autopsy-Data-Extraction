$ErrorActionPreference = 'Stop'
$AUTOPSY = 'C:\Program Files\Autopsy-4.22.1'
$SCRIPT = Split-Path -Parent $MyInvocation.MyCommand.Path
$CORE = "$AUTOPSY\autopsy\modules\org-sleuthkit-autopsy-core.jar"
$PATCHED = Join-Path $SCRIPT 'patch\org-sleuthkit-autopsy-core-patched.jar'

if (-not (Test-Path $PATCHED)) { throw "Run build first; missing: $PATCHED" }

Copy-Item -Force $CORE "$CORE.bak"
Copy-Item -Force $PATCHED $CORE
Write-Host '[OK] Patched core installed.'

$CACHE = Join-Path $env:LOCALAPPDATA 'autopsy\Cache\dev'
$CACHE_FILES = @(
  'all-layers.dat', 'all-manifests.dat', 'all-resources.dat', 'all-modules.dat',
  'all-installer.dat', 'all-clusters.dat', 'all-files.dat', 'package-attrs.dat', 'localeVariants'
)
foreach ($f in $CACHE_FILES) {
  $p = Join-Path $CACHE $f
  if (Test-Path $p) { Remove-Item -Force $p }
}
$lm = Join-Path $CACHE 'lastModified\all-checksum.txt'
if (Test-Path $lm) { Remove-Item -Force $lm }

try { "$(Get-Date)" | Out-File -FilePath "$AUTOPSY\autopsy\.patch-timestamp" -Encoding ascii } catch { }
Write-Host '[OK] Cache cleared. You can start Autopsy.'
