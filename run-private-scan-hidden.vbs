' Runs run-private-scan.bat with no visible window (2026-10-27), the same way
' the trigger watcher is started. Task Scheduler calls this hourly via wscript.exe.
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c """ & folder & "\run-private-scan.bat""", 0, True
