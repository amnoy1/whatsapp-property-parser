# setup-task-scheduler.ps1
# Run once as Administrator to register the daily 08:00 task.
# Usage: Right-click → Run as Administrator, OR:
#   Start-Process powershell -Verb RunAs -ArgumentList "-File setup-task-scheduler.ps1"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath   = (Get-Command node -ErrorAction Stop).Source
$scriptPath = Join-Path $projectDir "src\daily-report.js"
$taskName   = "WhatsApp Property Report - Mango Realty"
$logDir     = Join-Path $projectDir "logs"
$logFile    = Join-Path $logDir "daily-report.log"

# Ensure logs directory exists
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$action = New-ScheduledTaskAction `
  -Execute    $nodePath `
  -Argument   "`"$scriptPath`"" `
  -WorkingDirectory $projectDir

$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit  (New-TimeSpan -Minutes 15) `
  -StartWhenAvailable `
  -DontStopOnIdleEnd  `
  -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
  -TaskName  $taskName `
  -Action    $action `
  -Trigger   $trigger `
  -Settings  $settings `
  -RunLevel  Highest `
  -Force | Out-Null

Write-Host ""
Write-Host "✅ Task registered: '$taskName'"
Write-Host "   Runs: daily at 08:00"
Write-Host "   Log:  $logFile"
Write-Host ""
Write-Host "To test immediately:"
Write-Host "   Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "To remove:"
Write-Host "   Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
