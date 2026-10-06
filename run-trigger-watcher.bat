@echo off
cd /d "C:\AIBA9E~1\WHATSA~1"
if not exist logs mkdir logs
rem Restart loop: the watcher exits when its Realtime channel closes for good,
rem and this brings it straight back so the admin-panel button keeps working.
rem stdout goes to nul because log() already writes every line to the log file;
rem stderr gets its own file - redirecting it into the same log locks it and log() fails silently.
:loop
node src\trigger-watcher.js > nul 2>> logs\trigger-watcher.err.log
echo [%date% %time%] watcher exited (code %errorlevel%) - restarting in 30s >> logs\trigger-watcher.log
ping -n 31 127.0.0.1 > nul
goto loop
