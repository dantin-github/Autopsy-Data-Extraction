@echo off
REM Install patched autopsy-core JAR and clear NetBeans cache
REM Requirements:
REM   1. Close Autopsy completely first
REM   2. Run this script as Administrator

set "AUTOPSY=C:\Program Files\Autopsy-4.22.1"
set "CORE=%AUTOPSY%\autopsy\modules\org-sleuthkit-autopsy-core.jar"
set "PATCHED=%~dp0patch\org-sleuthkit-autopsy-core-patched.jar"
set "CACHE=%LOCALAPPDATA%\autopsy\Cache\dev"

if not exist "%PATCHED%" (
    echo [ERROR] Patched core not found. Run build-patch-core.bat first.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Case Data Extract - Core Patch Installer
echo ==========================================
echo.
echo IMPORTANT: Make sure Autopsy is fully closed before continuing!
echo.
pause

echo [1/3] Backing up original core...
copy /Y "%CORE%" "%CORE%.bak"
if errorlevel 1 (
    echo [FAIL] Cannot access core JAR.
    echo        Close Autopsy completely and run this script as Administrator.
    pause
    exit /b 1
)
echo [OK] Backup: %CORE%.bak

echo [2/3] Installing patched core...
copy /Y "%PATCHED%" "%CORE%"
if errorlevel 1 (
    echo [FAIL] Copy failed.
    echo        Restore with: copy "%CORE%.bak" "%CORE%"
    pause
    exit /b 1
)
echo [OK] Patched core installed.

echo [3/3] Clearing NetBeans platform cache...
REM NetBeans caches module data (layer.xml, manifests, resources) in .dat files.
REM These must be deleted when module JARs change, otherwise the old cache is used.
set "CACHE_FILES=all-layers.dat all-manifests.dat all-resources.dat all-modules.dat all-installer.dat all-clusters.dat all-files.dat package-attrs.dat localeVariants"

for %%F in (%CACHE_FILES%) do (
    if exist "%CACHE%\%%F" (
        del /Q "%CACHE%\%%F" 2>nul
        if exist "%CACHE%\%%F" (
            echo   [WARN] Could not delete %%F - Autopsy may still be running
        ) else (
            echo   [OK] Deleted %%F
        )
    )
)
if exist "%CACHE%\lastModified\all-checksum.txt" (
    del /Q "%CACHE%\lastModified\all-checksum.txt" 2>nul
    echo   [OK] Deleted lastModified\all-checksum.txt
)

REM Touch the autopsy cluster directory to force cache invalidation on next run
copy /b "%AUTOPSY%\autopsy" +,, >nul 2>&1
REM Alternatively, create/update a marker file in the cluster
echo %DATE% %TIME% > "%AUTOPSY%\autopsy\.patch-timestamp" 2>nul

echo.
echo ==========================================
echo  Installation complete!
echo ==========================================
echo.
echo  Plugin: Case Data Extract Report Module
echo  Report: Tools - Generate Report - [look for Case Data Extract]
echo  Window: Window - Case Data Extract Status (menu item)
echo.
echo  If plugin still not visible, try running clear-cache-and-restart.bat
echo.
echo  To restore original: copy "%CORE%.bak" "%CORE%"
echo.
pause
