$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'LaTeX Editor.lnk'
if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed: $lnk" } else { Write-Host 'Not installed.' }
