@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File setup-private-scan-task.ps1
pause
