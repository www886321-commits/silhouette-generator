@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node "%~dp0local-server.mjs" --stop
  exit /b
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0local-server.py" --stop
  exit /b
)
python "%~dp0local-server.py" --stop
