@echo off
cd /d "%~dp0"
curl.exe -s -o nul --max-time 1 http://127.0.0.1:8170/api/ping
if %errorlevel%==0 goto open
wscript "%~dp0launcher.vbs"
set /a tries=0
:wait
set /a tries+=1
if %tries% gtr 30 goto open
timeout /t 1 /nobreak >nul
curl.exe -s -o nul --max-time 1 http://127.0.0.1:8170/api/ping
if not %errorlevel%==0 goto wait
:open
start "" http://localhost:8170
