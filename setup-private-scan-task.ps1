# One-time: registers the hourly private-chat scan (2026-10-27).
# Every hour at :25 — clear of the 08:00 daily report, which uses the same
# WhatsApp session (the scan also skips any hour the report holds the lock).
# Runs hidden, as the logged-in user, on battery too, at most 15 minutes.

$taskName = 'WhatsApp Private Chat Scan - Mango Realty'
# Short (8.3) path, like the other two tasks: the Hebrew folder name breaks the task action otherwise.
$vbs      = (New-Object -ComObject Scripting.FileSystemObject).GetFile((Join-Path $PSScriptRoot 'run-private-scan-hidden.vbs')).ShortPath

$action   = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument "`"$vbs`""
$start    = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes(25)
if ($start -lt (Get-Date)) { $start = $start.AddHours(1) }
$trigger  = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered '$taskName' - first run $start, then hourly."
Write-Host "Remove: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
