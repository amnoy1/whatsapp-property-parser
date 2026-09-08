@echo off
cd /d "C:\AIBA9E~1\WHATSA~1"
if not exist logs mkdir logs
node src\trigger-watcher.js >> logs\trigger-watcher.log 2>&1
