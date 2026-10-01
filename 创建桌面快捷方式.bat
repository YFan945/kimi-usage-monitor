@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\KimiMonitor.lnk'); $lnk.TargetPath = '%~dp0启动监控.bat'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = '%~dp0public\favicon.ico'; $lnk.Save()"
echo 已在桌面创建"KimiMonitor"快捷方式。
ping -n 2 127.0.0.1 >nul
