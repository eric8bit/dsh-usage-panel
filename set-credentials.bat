@echo off
setlocal EnableExtensions
chcp 65001 >nul
title dsh-usage-panel 配置凭据
cd /d "%~dp0"

rem 录入 opencode 凭据,保存到 %DSH_HOME%\usage-panel.json
rem (DSH 宿主插件每次抓取时读取,改完即时生效,无需重装/重启)。

set "CFG=%USERPROFILE%\.dsh\usage-panel.json"
if defined DSH_HOME set "CFG=%DSH_HOME%\usage-panel.json"

echo ================================================
echo   dsh-usage-panel  配置凭据
echo ================================================
echo.
echo ① auth cookie： 登录 opencode.ai → F12 → Application → Cookies
echo    → opencode.ai → 复制名为 auth 的值
echo ② workspace id：打开用量页面 → F12 → Network，任一请求 URL 中
echo    的 wrk_ 开头参数
echo.
echo 保存位置：%CFG%
echo.

set "AUTH="
set "WS="
set /p "AUTH=请输入 auth cookie："
set /p "WS=请输入 workspace id（wrk_ 开头）："
if "%AUTH%"=="" (
    echo x cookie 不能为空
    pause
    exit /b 1
)
if "%WS%"=="" (
    echo x workspace id 不能为空
    pause
    exit /b 1
)

set "OPCODE_AUTH=%AUTH%"
set "OPCODE_WORKSPACE_ID=%WS%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%CFG%';[IO.Directory]::CreateDirectory((Split-Path -Parent $d))|Out-Null;$j=(@{auth=$env:OPCODE_AUTH;workspaceId=$env:OPCODE_WORKSPACE_ID}|ConvertTo-Json -Compress);[IO.File]::WriteAllText($d,$j,[Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
    echo x 保存失败，请重试。若 cookie 含特殊字符，可尝试直接编辑 %CFG%
    pause
    exit /b 1
)
echo.
echo ok 凭据已保存。刷新 DSH web 页面即可看到数据。
echo    如果数据未更新,等待最多 30 秒自动重试即可。
echo.
pause