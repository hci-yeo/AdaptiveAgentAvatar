@echo off
rem Double-click to put the avatar on the Kimi desktop app's window.
rem Kimi refuses to start with a debug port, so nothing in Kimi changes or restarts: the avatar is a
rem see-through window that stands beside Kimi's chat box, reading Kimi's window the way a screen
rem reader does (what you send, and whether Kimi is answering).
cd /d "%~dp0.."
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"
title Kimi with Avatar

node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed but was not found.
  echo Opening https://nodejs.org - install the LTS version, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\@huggingface\transformers" (
  echo First run: installing the AI topic library, this takes about a minute...
  call npm install --no-fund --no-audit --loglevel=error
)
if not exist "pet\node_modules\electron\dist\electron.exe" (
  echo First run: installing the pet program ^(Electron, about 160 MB^), this takes a minute or two...
  pushd pet
  call npm install --no-fund --no-audit --loglevel=error || echo Could not install it.
  popd
)

node launch.mjs kimi
if errorlevel 1 (
  echo.
  echo Could not turn the Kimi avatar on. See the message above.
  pause
  exit /b 1
)
echo Done! This window closes in a few seconds.
timeout /t 4 >nul
