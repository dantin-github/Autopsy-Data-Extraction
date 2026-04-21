$ErrorActionPreference = 'Stop'
$AUTOPSY = 'C:\Program Files\Autopsy-4.22.1'
$SCRIPT = Split-Path -Parent $MyInvocation.MyCommand.Path
$JAVAC = Join-Path $AUTOPSY 'jre\bin\javac.exe'
$JAR = Join-Path $AUTOPSY 'jre\bin\jar.exe'

if (-not (Test-Path $JAVAC)) { throw "javac not found: $JAVAC" }

$cp2 = @(
  "$AUTOPSY\platform\lib\org-openide-util.jar",
  "$AUTOPSY\platform\lib\org-openide-util-lookup.jar",
  "$AUTOPSY\platform\lib\org-openide-util-ui.jar",
  "$AUTOPSY\platform\modules\org-openide-windows.jar",
  "$AUTOPSY\autopsy\modules\org-sleuthkit-autopsy-core.jar"
) | Where-Object { Test-Path $_ }

$sk = @(Get-ChildItem "$AUTOPSY\autopsy\modules\ext\sleuthkit-*.jar" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$classpath = ($cp2 + $sk) -join ';'

$SRC = Join-Path $SCRIPT 'src'
$OUT = Join-Path $SCRIPT 'build\classes'
New-Item -ItemType Directory -Force -Path $OUT | Out-Null

$rel = @(
  'CanonicalJson.java',
  'CaseDataExtractReportModule.java',
  'CaseDataExtractReportModuleSettings.java',
  'CaseDataExtractUploadPreferences.java',
  'CaseEventRecorder.java',
  'CaseDataExtractMonitorTopComponent.java',
  'OpenCaseDataExtractMonitorAction.java',
  'UploadSettingsPanel.java',
  'gateway\GatewayClient.java',
  'gateway\GatewayError.java',
  'gateway\GatewayUploadException.java',
  'gateway\JsonStrings.java',
  'gateway\PingResult.java',
  'gateway\SimpleJson.java',
  'gateway\UploadRequest.java',
  'gateway\UploadResponse.java'
)
$files = $rel | ForEach-Object { Join-Path $SRC "org\sleuthkit\autopsy\report\caseextract\$_" }

Write-Host '[1/5] Compiling...'
& $JAVAC -source 17 -target 17 -encoding UTF-8 -proc:none -cp $classpath -d $OUT @files
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$destRoot = Join-Path $OUT 'org\sleuthkit\autopsy\report\caseextract'
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
Copy-Item -Force (Join-Path $SRC 'org\sleuthkit\autopsy\report\caseextract\Bundle.properties') $destRoot

$ORIG = Join-Path $SCRIPT 'patch\core.jar'
if (-not (Test-Path $ORIG)) { throw "Missing original core: $ORIG" }

$WORK = Join-Path $SCRIPT 'patch\work'
Remove-Item -Recurse -Force $WORK -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $WORK | Out-Null
Push-Location $WORK
& $JAR xf $ORIG
Pop-Location

$plug = Join-Path $OUT 'org\sleuthkit\autopsy\report\caseextract'
$wplug = Join-Path $WORK 'org\sleuthkit\autopsy\report\caseextract'
New-Item -ItemType Directory -Force -Path $wplug | Out-Null
Copy-Item -Recurse -Force "$plug\*" $wplug

Copy-Item -Force (Join-Path $SCRIPT 'install-config\core-layer-patched.xml') (Join-Path $WORK 'org\sleuthkit\autopsy\core\layer.xml')
$svc = Join-Path $WORK 'META-INF\services'
New-Item -ItemType Directory -Force -Path $svc | Out-Null
Copy-Item -Force (Join-Path $SCRIPT 'install-config\core-GeneralReportModule-services.txt') (Join-Path $svc 'org.sleuthkit.autopsy.report.GeneralReportModule')

$PATCHED = Join-Path $SCRIPT 'patch\org-sleuthkit-autopsy-core-patched.jar'
Push-Location $WORK
& $JAR cfm $PATCHED 'META-INF\MANIFEST.MF' .
Pop-Location
if (-not (Test-Path $PATCHED)) { throw 'JAR not created' }
Write-Host "[OK] Patched core: $PATCHED"
Write-Host 'Install: run _agent_install_elevated.ps1 or install-patch-core.bat as Administrator.'
