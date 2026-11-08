@echo off
cd /d "%~dp0"
if not exist "node_modules\ws\package.json" goto install
if not exist "node_modules\pinyin-pro\package.json" goto install
if not exist "node_modules\opencc-js\package.json" goto install
goto start

:install
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)

:start
node server.js
if errorlevel 1 pause
