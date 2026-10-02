@echo off
chcp 65001 >nul
setlocal
set "PORT=43110"
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"
curl -s -X POST "http://127.0.0.1:%PORT%/api/quit" >nul 2>nul
echo 已尝试向端口 %PORT% 发送退出请求。若监控仍在运行，请通过页面或托盘选择"退出"。
ping -n 2 127.0.0.1 >nul
