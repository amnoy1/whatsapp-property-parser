@echo off
cd /d "C:\AIBA9E~1\WHATSA~1"
if not exist logs mkdir logs
node src\daily-report.js >> logs\daily-report.log 2>&1
