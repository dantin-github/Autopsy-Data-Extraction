@echo off
REM Build and inject Case Data Extract plugin into autopsy-core JAR
REM Uses javac from Autopsy's bundled JRE - no external Ant needed

set "SCRIPT=%~dp0"
cd /d "%SCRIPT%"

set "AUTOPSY=C:\Program Files\Autopsy-4.22.1"
set "JAVAC=%AUTOPSY%\jre\bin\javac.exe"
set "JAR_TOOL=%AUTOPSY%\jre\bin\jar.exe"

if not exist "%JAVAC%" (
    echo [ERROR] javac not found at: %JAVAC%
    pause
    exit /b 1
)

REM ---- Build classpath from all Autopsy JARs ----
set "CP="
for %%j in ("%AUTOPSY%\platform\modules\*.jar") do set "CP=!CP!;%%j"
for %%j in ("%AUTOPSY%\platform\lib\*.jar") do set "CP=!CP!;%%j"
for %%j in ("%AUTOPSY%\autopsy\modules\*.jar") do set "CP=!CP!;%%j"

REM Fallback: use EnableDelayedExpansion trick
setlocal enabledelayedexpansion
set "CP2="
for %%j in ("%AUTOPSY%\platform\lib\org-openide-util.jar" "%AUTOPSY%\platform\lib\org-openide-util-lookup.jar" "%AUTOPSY%\platform\lib\org-openide-util-ui.jar" "%AUTOPSY%\platform\modules\org-openide-windows.jar" "%AUTOPSY%\autopsy\modules\org-sleuthkit-autopsy-core.jar" "%AUTOPSY%\autopsy\modules\ext\sleuthkit-4.14.0.jar") do (
    if exist "%%~j" set "CP2=!CP2!;%%~j"
)

echo [1/5] Compiling Java sources...
set "SRC=%SCRIPT%src"
set "OUT=%SCRIPT%build\classes"
if not exist "%OUT%" mkdir "%OUT%"

"%JAVAC%" -source 17 -target 17 -encoding UTF-8 -proc:none ^
  -cp "%CP2%" ^
  -d "%OUT%" ^
  "%SRC%\org\sleuthkit\autopsy\report\caseextract\CaseDataExtractReportModule.java" ^
  "%SRC%\org\sleuthkit\autopsy\report\caseextract\CaseEventRecorder.java" ^
  "%SRC%\org\sleuthkit\autopsy\report\caseextract\CaseDataExtractMonitorTopComponent.java" ^
  "%SRC%\org\sleuthkit\autopsy\report\caseextract\OpenCaseDataExtractMonitorAction.java"

if errorlevel 1 (
    echo [FAIL] Compilation failed.
    pause
    exit /b 1
)

REM Copy non-Java resources (Bundle.properties, layer.xml, etc.)
xcopy /s /y "%SRC%\org\sleuthkit\autopsy\report\caseextract" "%OUT%\org\sleuthkit\autopsy\report\caseextract\" /EXCLUDE:"%SCRIPT%build-exclude.txt" >nul 2>&1
REM Fallback copy for resources
copy /Y "%SRC%\org\sleuthkit\autopsy\report\caseextract\Bundle.properties" "%OUT%\org\sleuthkit\autopsy\report\caseextract\" >nul 2>&1

set "CORE=%AUTOPSY%\autopsy\modules\org-sleuthkit-autopsy-core.jar"
set "ORIG=%SCRIPT%patch\core.jar"
set "WORK=%SCRIPT%patch\work"

if not exist "%ORIG%" (
    echo [ERROR] Original core JAR not found at: %ORIG%
    echo         Cannot patch without the original.
    pause
    exit /b 1
)

echo [2/5] Extracting ORIGINAL core JAR (patch\core.jar)...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
pushd "%WORK%"
"%JAR_TOOL%" xf "%ORIG%"
popd

echo [3/5] Copying plugin classes into core...
if not exist "%WORK%\org\sleuthkit\autopsy\report\caseextract" mkdir "%WORK%\org\sleuthkit\autopsy\report\caseextract"
xcopy /s /y "%OUT%\org\sleuthkit\autopsy\report\caseextract" "%WORK%\org\sleuthkit\autopsy\report\caseextract\" >nul

echo [4/5] Patching layer.xml...
copy /Y "%SCRIPT%install-config\core-layer-patched.xml" "%WORK%\org\sleuthkit\autopsy\core\layer.xml" >nul

echo [4b/5] Patching META-INF/services...
copy /Y "%SCRIPT%install-config\core-GeneralReportModule-services.txt" "%WORK%\META-INF\services\org.sleuthkit.autopsy.report.GeneralReportModule" >nul

echo [5/5] Repackaging core JAR (preserving original manifest)...
if not exist "%SCRIPT%patch" mkdir "%SCRIPT%patch"
pushd "%WORK%"
"%JAR_TOOL%" cfm "%SCRIPT%patch\org-sleuthkit-autopsy-core-patched.jar" "META-INF\MANIFEST.MF" .
popd

if errorlevel 1 (
    echo [FAIL] JAR creation failed.
    pause
    exit /b 1
)

echo.
echo [OK] Patched core: patch\org-sleuthkit-autopsy-core-patched.jar
echo      Run install-patch-core.bat as Administrator to install.
echo      (Close Autopsy first!)
echo.
pause
