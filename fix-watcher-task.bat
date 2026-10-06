@echo off
rem One-time fix for the admin-panel watcher's scheduled task (Oct 2026).
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
powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'WhatsApp Trigger Watcher - Mango Realty' -Trigger (New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + '\' + $env:USERNAME)) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable) | Out-Null; $t = Get-ScheduledTask -TaskName 'WhatsApp Trigger Watcher - Mango Realty'; Write-Host ''; Write-Host ('Trigger:    ' + $t.Triggers[0].CimClass.CimClassName); Write-Host ('Time limit: ' + $t.Settings.ExecutionTimeLimit); Write-Host ''; Write-Host 'DONE - you can close this window.' -ForegroundColor Green"
pause
