@echo off
rem One-time fix (2026-10-21): run the admin-panel watcher with no visible window,
rem so closing a black console window can no longer kill it.
rem Must be run as administrator: right-click -> Run as administrator.
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  *** Not running as administrator ***
  echo  Close this window, right-click the file and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -Command "$n = 'WhatsApp Trigger Watcher - Mango Realty'; Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue; Set-ScheduledTask -TaskName $n -Action (New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument '\"C:\AIBA9E~1\WHATSA~1\run-trigger-watcher-hidden.vbs\"') | Out-Null; Start-ScheduledTask -TaskName $n; Start-Sleep -Seconds 3; $t = Get-ScheduledTask -TaskName $n; Write-Host ''; Write-Host ('Action: ' + $t.Actions[0].Execute + ' ' + $t.Actions[0].Arguments); Write-Host ('State:  ' + $t.State); Write-Host ''; Write-Host 'DONE - the watcher now runs hidden. You can close this window.' -ForegroundColor Green"
pause
