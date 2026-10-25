$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'LaTeX Editor.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $root 'launcher.vbs') + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'LaTeX Editor server (localhost:8170)'
$s.Save()
Write-Host "Installed: $lnk"
