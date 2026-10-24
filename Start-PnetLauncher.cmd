@echo off
rem PNET LaunchLab (standalone): installs dependencies the first time, starts the app on http://127.0.0.1:5180 and opens it.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)
start "" http://127.0.0.1:5180
call npm run dev
