@echo off
chcp 65001 >nul
setlocal
set "PORT=43110"
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"
curl -s -X POST "http://127.0.0.1:%PORT%/api/quit" >nul 2>nul
echo 已请求停止本地监控服务（端口 %PORT%）。
ping -n 2 127.0.0.1 >nul
