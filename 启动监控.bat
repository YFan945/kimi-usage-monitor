@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Kimi Code 用量监控

rem --- 读取端口（服务启动时写入的 port.txt，默认 43110）---
set "PORT=43110"
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"

rem --- 选择 Node：系统 PATH 优先，其次程序自带 runtime\node.exe ---
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if defined NODE_EXE goto run
echo [Kimi Code 用量监控] 未找到 Node.js。
echo 请安装 Node.js，或从任意一台装了 Node 的电脑复制 node.exe 到 runtime\ 文件夹。
pause
exit /b 1

:run
rem --- 启动本地服务（若已在运行，新进程检测到端口占用会自动退出，复用旧服务）---
start "kimi-monitor-server" /min cmd /c ""%NODE_EXE%" "%~dp0server.js" --port %PORT%"
ping -n 3 127.0.0.1 >nul

rem --- 以独立应用窗口打开（Edge 应用模式，无地址栏；无 Edge 则用默认浏览器）---
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" start "" "%EDGE%" --app="http://127.0.0.1:%PORT%/" --window-size=1280,900
if not exist "%EDGE%" start "" "http://127.0.0.1:%PORT%/"
echo 已打开监控窗口。关闭窗口不会停止服务；要停止请运行 停止监控.bat 或点页面右上角"退出"。
ping -n 3 127.0.0.1 >nul
