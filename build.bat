@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   KimiMonitor 一键打包
echo   全部 Windows 产物：build.bat
echo   加 mac 包：        build.bat --mac
echo   构建后上传 Release：build.bat --release
echo ============================================
node build.js %*
pause
