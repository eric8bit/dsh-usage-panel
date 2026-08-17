@echo off
setlocal EnableExtensions
chcp 65001 >nul
title dsh-usage-panel 一键安装
cd /d "%~dp0"

rem ================================================================
rem  dsh-usage-panel 一键安装（懒人版）
rem  数据由 DSH 宿主进程直接抓取,挂在 DSH web 的同源路由上,
rem  不需要独立数据服务,不需要常驻终端窗口。
rem  装完后运行一次 set-credentials.bat 录入凭据,刷新页面即可。
rem ================================================================

set "PROFILE=web"
set "STAGE=%LOCALAPPDATA%\dsh-usage-panel"
if not defined LOCALAPPDATA set "STAGE=%TEMP%\dsh-usage-panel"
set "PROFILES_DIR=%USERPROFILE%\.dsh\profiles\%PROFILE%"
if defined DSH_HOME set "PROFILES_DIR=%DSH_HOME%\profiles\%PROFILE%"
set "INSTALLED=%PROFILES_DIR%\node_modules\dsh-usage-panel"

echo ================================================
echo   dsh-usage-panel  一键安装（懒人版）
echo ================================================
echo.

if not exist "%STAGE%" mkdir "%STAGE%"

where node >nul 2>nul || (
    echo [x] 未找到 Node.js，请先安装 https://nodejs.org/ 后重试
    pause & exit /b 1
)
where npm >nul 2>nul || (
    echo [x] 未找到 npm（Node.js 应自带），请重装 Node.js
    pause & exit /b 1
)
where dsh >nul 2>nul || (
    echo [x] 未找到 dsh 命令，请先安装 DeepSeek Harness：
    echo          npm install -g @deepseek-ai/dsh
    pause & exit /b 1
)
where pnpm >nul 2>nul || (
    echo 未找到 pnpm，正在自动安装...
    call npm install -g pnpm --no-fund --no-audit
    where pnpm >nul 2>nul || (
        echo [x] pnpm 自动安装失败，请手动执行： npm install -g pnpm
        pause & exit /b 1
    )
    echo   ok pnpm 已自动安装
)
echo [1/3] ok  环境就绪（node / npm / dsh / pnpm）

echo [2/3] 打包并安装插件到 %PROFILE% profile ...
del /q "%STAGE%\dsh-usage-panel-*.tgz" >nul 2>&1
call npm pack --pack-destination "%STAGE%" > "%STAGE%\pack.log" 2>&1
if errorlevel 1 (
    echo        [x] 打包失败，日志：%STAGE%\pack.log
    pause & exit /b 1
)
set "TGZ="
for /f "delims=" %%F in ('dir /b "%STAGE%\dsh-usage-panel-*.tgz" 2^>nul') do set "TGZ=%STAGE%\%%F"
if not defined TGZ (
    echo        [x] 未找到打包产物（%STAGE%）
    pause & exit /b 1
)
call dsh plugin --profile %PROFILE% add "%TGZ%" > "%STAGE%\install.log" 2>&1
if errorlevel 1 (
    echo        [x] 安装失败，日志：%STAGE%\install.log
    echo          手动命令： dsh plugin --profile %PROFILE% add "%TGZ%"
    pause & exit /b 1
)
if not exist "%INSTALLED%\package.json" (
    echo        [x] 未检测到已安装内容，日志：%STAGE%\install.log
    pause & exit /b 1
)

echo [3/3] ok  插件已安装完成！
echo.
echo ================================================
echo   下一步（只需一次）：
echo   双击 set-credentials.bat，粘贴 opencode 的
echo   auth cookie 与 workspace id 即可。
echo.
echo   之后：使改动生效请「重启 DSH web」或按提示热重载，
echo   然后刷新页面 —— 右下角出现用量卡片。
echo   数据由宿主进程抓取，无需常驻任何窗口。
echo ================================================
echo.
pause