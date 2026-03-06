@echo off
REM =====================================================
REM  Case Data Extract - Patch Installer
REM  RIGHT-CLICK this file and choose "Run as administrator"
REM =====================================================

set "SCRIPT=%~dp0"
cd /d "%SCRIPT%"

set "CORE=C:\Program Files\Autopsy-4.22.1\autopsy\modules\org-sleuthkit-autopsy-core.jar"
set "PATCHED=%SCRIPT%patch\org-sleuthkit-autopsy-core-patched.jar"
set "CACHE=%LOCALAPPDATA%\autopsy\Cache\dev"

echo.
echo =====================================================
echo  Case Data Extract - Patch Installer
echo =====================================================
echo.
echo  Make sure Autopsy is CLOSED before continuing.
echo.
pause

if not exist "%PATCHED%" (
    echo [ERROR] Patched JAR not found: %PATCHED%
    pause
    exit /b 1
)

echo [1/4] Removing conflicting standalone module JAR...
set "STANDALONE=C:\Program Files\Autopsy-4.22.1\autopsy\modules\org-sleuthkit-autopsy-report-caseextract.jar"
if exist "%STANDALONE%" (
    del /Q "%STANDALONE%"
    echo [OK] Standalone JAR removed.
) else (
    echo [OK] Standalone JAR not present, skipping.
)

echo [2/4] Installing patched core JAR...
copy /Y "%CORE%" "%CORE%.bak" >nul 2>&1
copy /Y "%PATCHED%" "%CORE%"
if errorlevel 1 (
    echo.
    echo [FAIL] Access denied.
    echo        Please RIGHT-CLICK this file and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)
echo [OK] Core JAR installed.

echo [3/4] Clearing NetBeans cache...
for %%F in (all-layers.dat all-manifests.dat all-resources.dat all-modules.dat all-installer.dat all-clusters.dat all-files.dat package-attrs.dat localeVariants) do (
    if exist "%CACHE%\%%F" del /Q "%CACHE%\%%F" 2>nul
)
if exist "%CACHE%\lastModified\all-checksum.txt" (
    del /Q "%CACHE%\lastModified\all-checksum.txt" 2>nul
)
echo [OK] Cache cleared.

echo [4/4] All steps complete.

echo.
echo =====================================================
echo  Done! Start Autopsy now.
echo  Report: Tools ^> Generate Report ^> Case Data Extract Report
echo  Window: Window ^> Case Data Extract Status
echo =====================================================
echo.
pause
