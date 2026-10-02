@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title KimiMonitor

rem --- 读取端口（服务启动时写入的 port.txt，默认 43110）---
set "PORT=43110"
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"

rem --- 选择 Node：系统 PATH 优先，其次程序自带 runtime\node.exe ---
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if defined NODE_EXE goto run
echo [KimiMonitor] 未找到 Node.js。
echo 源码运行需要 Node.js 18 或更高版本；绿色发行包已含 runtime\node.exe，请确认完整解压。
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
echo 已尝试打开监控界面。关闭窗口不会停止服务；请通过页面或托盘"退出"，也可运行 停止监控.bat。
ping -n 3 127.0.0.1 >nul
