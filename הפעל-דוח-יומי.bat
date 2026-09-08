@echo off
cd /d "%~dp0"
echo.
echo מריץ דוח נכסים יומי...
echo.
node src/daily-report.js
pause
