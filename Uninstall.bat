@echo off
rem Takes the avatar off this PC: closes her tray icon, turns her off in every app, removes the
rem DeepSeek Harness plugin and the Claude Code hooks if they were added from this folder, and removes
rem the "AI Avatar" shortcuts, "Start with Windows" and two small settings folders. Then you can
rem delete this folder.
cd /d "%~dp0"
title Uninstall AI Avatar
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0node;%PATH%"

echo This turns the avatar off everywhere and removes what Install.bat and the scripts added.
choice /c YN /m "Uninstall AI Avatar"
if errorlevel 2 exit /b 0

rem 1. Ask the tray icon to quit (it turns the avatar off as it goes; it checks every 4 seconds).
type nul > .tray.stop
echo Closing the tray icon...
timeout /t 6 /nobreak >nul
del .tray.stop >nul 2>nul

rem 2. Make sure the avatar is off everywhere (as Turn Avatar Off.bat).
type nul > .mods-off
if exist .watcher.pid (
  for /f %%p in (.watcher.pid) do taskkill /F /FI "PID eq %%p" /FI "IMAGENAME eq node.exe" >nul 2>nul
  del .watcher.pid >nul 2>nul
)
node watcher.mjs --off >nul 2>nul

rem 3. The DeepSeek Harness plugin, only if it runs from this folder.
node tools\dsh-plugin.mjs --remove-if-here

rem 4. The Claude Code hooks, only if they were added.
findstr /c:"claude-hook.mjs" "%USERPROFILE%\.claude\settings.json" >nul 2>nul && node tools\install-claude-hooks.mjs --remove

rem 5. The shortcuts, "Start with Windows", and the settings folders in %APPDATA%.
if exist "pet\node_modules\electron\dist\electron.exe" "%~dp0pet\node_modules\electron\dist\electron.exe" "%~dp0pet\setup.js" --uninstall

echo.
echo AI Avatar is uninstalled. You can delete this folder now.
pause
