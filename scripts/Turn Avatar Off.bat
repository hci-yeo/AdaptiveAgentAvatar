@echo off
rem Double-click to turn the mods off in the open Doubao, Codex and Yuanbao windows.
cd /d "%~dp0.."
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"
title Doubao Mods

rem Tell the tray icon the avatar was turned off on purpose, so it doesn't restart it.
rem (Opening an app with its Start file, or "Turn avatar back on" in the tray, clears this.)
type nul > .mods-off

rem Stop the background watcher (only if that PID is still a node.exe process).
if exist .watcher.pid (
  for /f %%p in (.watcher.pid) do taskkill /F /FI "PID eq %%p" /FI "IMAGENAME eq node.exe" >nul 2>nul
  del .watcher.pid >nul 2>nul
)

node watcher.mjs --off
if errorlevel 1 (
  echo No app is running with mods, so there was nothing to remove.
) else (
  echo The avatar is off everywhere. Use the tray, or a "Start ... with Avatar" file, to turn her back on.
)
timeout /t 4 >nul
