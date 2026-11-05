@echo off
rem Optional, for the Claude avatar: adds small hooks to your Claude Code settings, so the avatar starts by itself and shows when Claude is using tools. A copy of your settings is kept first.
cd /d "%~dp0.."
title Avatar for Claude Code
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"

node tools\install-claude-hooks.mjs
echo.
pause
