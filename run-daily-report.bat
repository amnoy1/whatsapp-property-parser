@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
node src\daily-report.js >> logs\daily-report.log 2>&1
