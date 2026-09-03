Set objFSO = CreateObject("Scripting.FileSystemObject")
strCurrentDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = strCurrentDir

' Runs python companion.py in a hidden console (0 = hidden, False = don't wait)
objShell.Run "cmd.exe /c python companion.py", 0, False
