@echo off
REM 使用 NetBeans 自带的 Ant 构建，无需单独安装 Ant
REM 用法: build.bat [Autopsy平台路径] [ant目标]
REM 示例: build.bat "D:\Autopsy\platform" jar
REM 若已创建 build.properties 并设置 autopsy.platform，可直接: build.bat jar
set "PLATFORM=C:\Program Files\Autopsy-4.22.1\platform"
set "ARGS=%*"
if "%~1" neq "" (
    if exist "%~1" (
        set "PLATFORM=%~1"
        shift
        set "ARGS=%*"
    )
)
set "ANT_HOME="
for %%d in (
    "C:\Program Files\Apache NetBeans 29\extide\ant"
    "C:\Program Files\Apache NetBeans 28\extide\ant"
    "C:\Program Files\Apache NetBeans\extide\ant"
    "C:\Program Files\NetBeans\netbeans\ext\ant"
) do (
    if exist %%d set "ANT_HOME=%%~d" & goto :found
)
echo [ERROR] Ant not found. Install Apache Ant or add NetBeans extide\ant to PATH.
exit /b 1
:found
REM 必须使用 Java 17（Autopsy 4.22 的 JAR 为 Java 17 编译）
set "JAVA17="
for %%j in (
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
    "C:\Program Files\Java\jdk-17"
    "C:\Program Files\Java\jdk-21"
    "C:\Program Files\Java\jdk-17.0.9"
    "C:\Program Files\Apache NetBeans 29\extide\jdk"
    "C:\Program Files\Apache NetBeans 28\extide\jdk"
    "C:\Program Files\Apache NetBeans\extide\jdk"
) do (
    if exist "%%~j\bin\javac.exe" set "JAVA17=%%~j" & goto :java_found
)
echo.
echo [ERROR] Java 17 JDK not found. Autopsy 4.22 requires Java 17 to build.
echo Please install JDK 17 from https://adoptium.net and set JAVA_HOME.
echo.
exit /b 1
:java_found
if defined JAVA17 set "JAVA_HOME=%JAVA17%" & set "PATH=%JAVA17%\bin;%PATH%"
set "PATH=%ANT_HOME%\bin;%PATH%"
ant -Dautopsy.platform="%PLATFORM%" %ARGS%
exit /b %ERRORLEVEL%
