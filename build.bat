@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   KimiMonitor Node/SEA 维护版打包
echo   Windows 产物：    build.bat
echo   同时生成 macOS 包：build.bat --mac
echo   构建并发布维护版：build.bat --release
echo   Rust 桌面版使用 npm run desktop 构建。
echo ============================================
node build.js %*
pause
