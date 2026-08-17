@echo off
setlocal EnableExtensions
chcp 65001 >nul
title dsh-usage-panel 一键卸载
cd /d "%~dp0"

set "PROFILE=web"
set "PROFILES_DIR=%USERPROFILE%\.dsh\profiles\%PROFILE%"
if defined DSH_HOME set "PROFILES_DIR=%DSH_HOME%\profiles\%PROFILE%"

echo ================================================
echo   dsh-usage-panel  一键卸载
echo ================================================
echo.

where dsh >nul 2>nul
if errorlevel 1 (
    echo x 未找到 dsh 命令，无法卸载插件。可手动删除
    echo   %PROFILES_DIR%\package.json 中 dsh-usage-panel 依赖及
    echo   dsh.profile.bundles 中的 dsh-usage-panel，然后 pnpm install。
    pause
    exit /b 1
)

echo 正在从 DSH web 移除插件...
call dsh plugin --profile %PROFILE% remove dsh-usage-panel
if errorlevel 1 (
    echo        x 卸载命令未完全成功（请查看上方输出）
) else (
    echo        ok 插件已从 %PROFILE% profile 移除
)

echo.
echo 完成：重启 / 刷新 DSH web 后右下角卡片即消失。
echo   凭据文件 %USERPROFILE%\.dsh\usage-panel.json 已保留，重装后可继续用。
echo.
pause