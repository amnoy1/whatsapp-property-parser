@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
git pull origin main >> logs\daily-report.log 2>&1
node src\daily-report.js >> logs\daily-report.log 2>&1
