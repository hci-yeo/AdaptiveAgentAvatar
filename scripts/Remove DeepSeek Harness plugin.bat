@echo off
rem Takes the avatar plugin out of DeepSeek Harness again.
cd /d "%~dp0.."
title Avatar for DeepSeek Harness
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"

node tools\dsh-plugin.mjs --remove
echo.
pause
