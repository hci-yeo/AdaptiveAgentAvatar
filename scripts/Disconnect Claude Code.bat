@echo off
rem Takes the avatar hooks out of your Claude Code settings again.
cd /d "%~dp0.."
title Avatar for Claude Code
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"

node tools\install-claude-hooks.mjs --remove
echo.
pause
