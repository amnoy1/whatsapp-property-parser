@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
node src\private-chat-scan.js >> logs\private-scan-console.log 2>&1
