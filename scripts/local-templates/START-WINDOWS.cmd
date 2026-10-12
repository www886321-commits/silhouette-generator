@echo off
cd /d "%~dp0"
title Silhouette Generator - Local Server
where node >nul 2>nul
if %errorlevel%==0 (
  node "%~dp0local-server.mjs" --start
  goto :done
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0local-server.py" --start
  goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0local-server.py" --start
  goto :done
)
echo Node.js or Python 3 is required. See AGENT-INSTALL.md.
pause
exit /b 1
:done
if not %errorlevel%==0 (
  echo Startup failed. Please share this window with your AI Agent.
  pause
)
exit /b
