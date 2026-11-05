@echo off
rem Double-click to put the avatar on the Claude desktop app (as a pet that stands on its window).
rem Claude does not need to restart. Run it again after restarting your PC (or tick "Start with Windows"
rem in the tray menu and connect Claude Code, see the other files in this folder).
cd /d "%~dp0.."
title Claude Avatar

rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"

node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed but was not found. Use the ready-to-run download from the Releases page.
  pause
  exit /b 1
)

echo Turning on the Claude avatar...
node launch.mjs claude
if errorlevel 1 (
  echo.
  echo Could not turn it on. See the message above.
  pause
  exit /b 1
)
echo Done! Open Claude: she stands beside its chat box. This window closes in a few seconds.
timeout /t 5 >nul
