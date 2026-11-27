@echo off
setlocal
cd /d "%~dp0"
if not exist "server\server.js" (
  echo [X] server\server.js not found in %CD%
  pause
  exit /b 1
)
set "HOST=0.0.0.0"
set "PORT=3000"
if exist ".runtime-node\node.exe" ( set "NODE_EXE=.runtime-node\node.exe" ) else ( set "NODE_EXE=node" )
echo Starting YanZhou live server on 0.0.0.0:3000 ...
echo Control panel:   http://localhost:3000/control.html
echo OBS browser src: http://localhost:3000/overlay.html
echo LAN access:      http://^<this-PC-IP^>:3000/control.html
echo.
echo Keep this window open. Press Ctrl+C to stop.
echo.
"%NODE_EXE%" server\server.js
pause
