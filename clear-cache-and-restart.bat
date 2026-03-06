@echo off
REM 清除 Autopsy/NetBeans 平台缓存，使补丁生效
REM 无需管理员权限（缓存在用户目录）

set "CACHE=%LOCALAPPDATA%\autopsy\Cache\dev"

echo ==========================================
echo  Autopsy Cache Cleaner
echo ==========================================
echo.
echo Cache directory: %CACHE%
echo.

if not exist "%CACHE%" (
    echo [INFO] Cache directory not found - nothing to clear.
    pause
    exit /b 0
)

echo Deleting cached module data...

del /Q "%CACHE%\all-layers.dat"     2>nul && echo   [OK] all-layers.dat   deleted || echo   [--] all-layers.dat   not found
del /Q "%CACHE%\all-manifests.dat"  2>nul && echo   [OK] all-manifests.dat deleted || echo   [--] all-manifests.dat not found
del /Q "%CACHE%\all-resources.dat"  2>nul && echo   [OK] all-resources.dat deleted || echo   [--] all-resources.dat not found
del /Q "%CACHE%\all-modules.dat"    2>nul && echo   [OK] all-modules.dat   deleted || echo   [--] all-modules.dat   not found
del /Q "%CACHE%\all-installer.dat"  2>nul && echo   [OK] all-installer.dat deleted || echo   [--] all-installer.dat not found
del /Q "%CACHE%\all-clusters.dat"   2>nul && echo   [OK] all-clusters.dat  deleted || echo   [--] all-clusters.dat  not found
del /Q "%CACHE%\all-files.dat"      2>nul && echo   [OK] all-files.dat     deleted || echo   [--] all-files.dat     not found
del /Q "%CACHE%\package-attrs.dat"  2>nul && echo   [OK] package-attrs.dat deleted || echo   [--] package-attrs.dat not found
del /Q "%CACHE%\localeVariants"     2>nul && echo   [OK] localeVariants    deleted || echo   [--] localeVariants    not found

if exist "%CACHE%\lastModified\all-checksum.txt" (
    del /Q "%CACHE%\lastModified\all-checksum.txt"
    echo   [OK] lastModified\all-checksum.txt deleted
)

echo.
echo [DONE] Cache cleared. Autopsy will rebuild it on next launch.
echo        Plugin should now appear under: Tools > Generate Report
echo.
pause
