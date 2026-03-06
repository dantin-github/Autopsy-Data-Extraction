@echo off
REM 手动安装 Case Data Extract 插件（绕过 NBM 解析器）
REM 需要先运行 build.bat jar 生成 JAR
REM 需要管理员权限（Program Files 写入）

set "AUTOPSY=C:\Program Files\Autopsy-4.22.1"
set "JAR=%~dp0dist\CaseDataExtract.jar"
set "MODULES=%AUTOPSY%\autopsy\modules"
set "CONFIG=%AUTOPSY%\autopsy\config\Modules"

if not exist "%JAR%" (
    echo [ERROR] JAR not found: %JAR%
    echo Run: build.bat jar
    exit /b 1
)

if not exist "%MODULES%" (
    echo [ERROR] Autopsy modules dir not found: %MODULES%
    echo Check AUTOPSY path.
    exit /b 1
)

echo Copying JAR to %MODULES%\org-sleuthkit-autopsy-report-caseextract.jar
copy /Y "%JAR%" "%MODULES%\org-sleuthkit-autopsy-report-caseextract.jar"

echo Creating module config...
if not exist "%CONFIG%" mkdir "%CONFIG%"
copy /Y "%~dp0install-config\org-sleuthkit-autopsy-report-caseextract.xml" "%CONFIG%\"

echo Creating update_tracking...
set "TRACKING=%AUTOPSY%\autopsy\update_tracking"
if not exist "%TRACKING%" mkdir "%TRACKING%"
copy /Y "%~dp0install-config\org-sleuthkit-autopsy-report-caseextract-update.xml" "%TRACKING%\org-sleuthkit-autopsy-report-caseextract.xml"

echo.
if exist "%MODULES%\org-sleuthkit-autopsy-report-caseextract.jar" (
    echo [OK] Plugin installed. Restart Autopsy.
    echo Menu: Window - 案件数据提取状态
    echo Report: Tools - Generate Report - 案件数据提取报告
) else (
    echo [FAIL] Access denied. Right-click install-manual.bat - Run as administrator
)
