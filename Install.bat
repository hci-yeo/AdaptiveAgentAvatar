@echo off
rem Run once after unzipping: adds an "AI Avatar" shortcut (her face) to your Desktop and Start menu.
rem It opens her menu by the clock, where you open an app with the avatar. Run it again if you move
rem this folder. Uninstall.bat takes everything out again.
cd /d "%~dp0"
title Install AI Avatar

set "ELECTRON=%~dp0pet\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo The pet program is missing from this folder. Please use the ready-to-run zip from the Releases page.
  pause
  exit /b 1
)

"%ELECTRON%" "%~dp0pet\setup.js" --install --open-tray
if errorlevel 1 (
  echo Could not create the shortcuts.
  pause
  exit /b 1
)
echo Added "AI Avatar" to your Desktop and Start menu.

rem After moving this folder: the DeepSeek Harness plugin and the Claude Code hooks follow it here, but
rem only if they were set up before and their old folder is gone. Otherwise these say nothing.
if exist "node\node.exe" set "PATH=%~dp0node;%PATH%"
node tools\dsh-plugin.mjs --move-here 2>nul
node tools\install-claude-hooks.mjs --move-here 2>nul
echo.
echo Her icon now appears by the clock (Windows 11 may hide it behind the ^^ arrow).
echo Click it to open Doubao, Codex, Yuanbao, Claude, Kimi or DeepSeek Harness with the avatar.
echo.
pause
