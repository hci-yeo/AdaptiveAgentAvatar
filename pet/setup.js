// Install.bat / Uninstall.bat helper, run on the pet program's Electron:
//   electron pet\setup.js --install [--open-tray]  adds the "AI Avatar" shortcut (her face) to the Desktop
//                                                  and the Start menu; it opens the tray (pet\tray.js).
//                                                  --open-tray: then start the tray, detached
//   electron pet\setup.js --uninstall [--keep-data] removes those shortcuts, the tray's "Start with
//                                                  Windows" entry, and the tray's and pet's small
//                                                  settings folders in %APPDATA% (unless --keep-data)
// Shortcuts are written with Electron's own shell.writeShortcutLink, with this folder's real paths
// (a shortcut stores full paths, so one can't ship inside the zip). Run --install again after
// moving the folder. Exit code 0 when everything worked.
'use strict';
const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const TRAY = path.join(__dirname, 'tray.js');
const ICON = path.join(__dirname, 'tray-icons', 'face.ico');
const NAME = 'AI Avatar';

app.setName(NAME);
// Electron's own scratch folder: inside this folder (pet/build, made at run time), never in %APPDATA%.
app.setPath('userData', path.join(__dirname, 'build', 'setup-data'));
app.disableHardwareAcceleration();

const shortcuts = () => [
  path.join(app.getPath('desktop'), `${NAME}.lnk`),
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`),
];

app.whenReady().then(() => {
  const argv = process.argv;
  let ok = true;
  if (argv.includes('--install')) {
    for (const file of shortcuts()) {
      const done = shell.writeShortcutLink(file, 'create', {   // create: new, or overwrite an old one
        target: process.execPath,          // this folder's Electron
        args: `"${TRAY}"`,
        cwd: ROOT,
        icon: ICON,
        iconIndex: 0,
        description: 'AI Avatar: the avatar\'s menu by the clock (open an app with her, turn her off...)',
        appUserModelId: 'AI Avatar',       // the same id the tray uses, so Windows groups them
      });
      if (!done) ok = false;
    }
    // Opened through Explorer, the same as double-clicking the new Start menu shortcut. Started
    // from here (or from Install.bat with `start`), the tray kept copies of the console window's
    // handles, so Install.bat's window could not close while the tray ran.
    if (ok && argv.includes('--open-tray')) {
      spawn('explorer.exe', [shortcuts()[1]], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } else if (argv.includes('--uninstall')) {
    for (const file of shortcuts()) {
      try { fs.rmSync(file, { force: true }); } catch { ok = false; }
    }
    // The tray's own "Start with Windows" entry (same program and arguments as pet\tray.js uses).
    app.setLoginItemSettings({ path: process.execPath, args: [TRAY], openAtLogin: false });
    if (!argv.includes('--keep-data')) {
      for (const dir of ['ai-avatar-tray', 'doubao-mods-pet']) {
        try { fs.rmSync(path.join(app.getPath('appData'), dir), { recursive: true, force: true }); } catch {}
      }
    }
  } else {
    ok = false;
  }
  app.exit(ok ? 0 : 1);
});
