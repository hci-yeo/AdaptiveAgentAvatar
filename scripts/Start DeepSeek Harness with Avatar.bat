@echo off
rem Double-click to open DeepSeek Harness with the avatar. The first time (or after moving this folder),
rem it adds the avatar to DeepSeek Harness as a plugin that runs from this folder.
cd /d "%~dp0.."
title DeepSeek Harness with Avatar

rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"

node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed but was not found. Use the ready-to-run download from the Releases page.
  pause
  exit /b 1
)

node tools\dsh-plugin.mjs --start
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
echo Done! This window closes in a few seconds.
timeout /t 4 >nul
