' Starts run-trigger-watcher.bat with no visible window (Amir, 2026-10-21).
' The watcher used to run in a black console window; closing that window
' killed it (exit 0xC000013A) and the admin "הרץ עכשיו" button went dead.
' The Task Scheduler task runs this file through wscript.exe. It waits for
' the .bat (which loops forever), so the task shows as Running while the
' watcher is alive.
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c """ & folder & "\run-trigger-watcher.bat""", 0, True
