@echo off
rem Double-click to open Yuanbao with the avatar (the mods in the "mods" folder).
cd /d "%~dp0.."
rem The ready-to-run download ships its own Node.js in the "node" folder: use it when it is there.
if exist "node\node.exe" set "PATH=%~dp0..\node;%PATH%"
title Yuanbao with Avatar

rem Needs Node.js 22 or newer.
node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed but was not found.
  echo Opening https://nodejs.org - install the LTS version, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

rem First run: install the AI library the avatar uses to recognise topics (one time).
if not exist "node_modules\@huggingface\transformers" (
  echo First run: installing the AI topic library, this takes about a minute...
  call npm install --no-fund --no-audit --loglevel=error
  if errorlevel 1 (
    echo Could not install it. The avatar still works; she will use simple keyword matching.
  )
)

rem First run: the tray icon (and pet mode) run on Electron, installed once into the pet folder.
if not exist "pet\node_modules\electron\dist\electron.exe" (
  echo First run: installing the tray icon program ^(Electron, about 160 MB^), this takes a minute or two...
  pushd pet
  call npm install --no-fund --no-audit --loglevel=error || echo Could not install it. The avatar still works, without the tray icon.
  popd
)

echo Opening Yuanbao with the avatar...
rem Starts Yuanbao (asking first if it has to restart), the hidden background process that keeps the
rem avatar there (shared by all the apps; its log is mods-log.txt), and the tray icon by the clock.
node launch.mjs yuanbao
if errorlevel 2 (
  timeout /t 4 >nul
  exit /b 0
)
if errorlevel 1 (
  echo.
  echo Could not open Yuanbao. See the message above.
  pause
  exit /b 1
)

echo Done! This window closes in a few seconds.
timeout /t 4 >nul
