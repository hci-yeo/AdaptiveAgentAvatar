// What differs between Windows and macOS, in one place: finding an app, listing its processes,
// starting it with switches, closing it, where settings live, and the "only one watcher" lock.
// Windows keeps its tried ways (tasklist, taskkill, a named pipe); the macOS half is new and still to
// be checked on a real Mac.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';

export const IS_MAC = process.platform === 'darwin';
export const IS_WIN = process.platform === 'win32';

const exec = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true }, (err, out) => res(String(out || ''))));

// ---- Settings folders ---------------------------------------------------------------------------
// The per-user folder for app settings: %APPDATA% on Windows, ~/Library/Application Support on macOS
// (the same folder Electron's app.getPath('appData') gives the tray, so both agree).
export function appDataDir() {
  if (IS_MAC) return join(homedir(), 'Library', 'Application Support');
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

// ---- The "only one watcher" lock ------------------------------------------------------------------
// A local socket only one process can listen on. Windows: a named pipe, which disappears with its
// process. macOS: a Unix socket file, which can outlive a crashed watcher, so a leftover file is tested
// (connect: refused = nobody holds it) and removed before listening (prepareLock).
const userKey = createHash('sha1').update(homedir()).digest('hex').slice(0, 12);
export const LOCK_PATH = IS_WIN ? `\\\\.\\pipe\\ai-avatar-watcher-${userKey}`
  : join('/tmp', `ai-avatar-watcher-${userKey}.sock`);   // short: Unix socket paths max out near 104 bytes

/** macOS: is a watcher holding the lock right now? (Windows answers by trying to listen: launch.mjs.) */
export function lockHeldUnix() {
  return new Promise(resolve => {
    if (!existsSync(LOCK_PATH)) return resolve(false);
    const s = createConnection(LOCK_PATH);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}
/** Before listening on the lock: on macOS, clear a socket file left by a watcher that crashed. */
export async function prepareLock() {
  if (IS_WIN) return;
  if (existsSync(LOCK_PATH) && !await lockHeldUnix()) try { unlinkSync(LOCK_PATH); } catch {}
}

// ---- Processes -----------------------------------------------------------------------------------
/** Windows: process ids of programs with this file name (tasklist ships with Windows). */
export async function pidsOfImage(image) {
  const out = await exec('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`]);
  return [...out.matchAll(/^"[^"]+","(\d+)"/gm)].map(m => Number(m[1]));
}
/** Windows Store apps: only this package's processes (the ChatGPT app uses the same file name as Codex). */
export async function pidsOfPackage(image, packagePrefix) {
  const out = await exec('tasklist', ['/APPS', '/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`]);
  return [...out.matchAll(/^"[^"]+","(\d+)","[^"]*","([^"]*)"/gm)].filter(m => m[2].startsWith(packagePrefix)).map(m => Number(m[1]));
}
/** macOS: process ids of everything running from inside this .app bundle (the app and its helpers). */
export async function pidsInBundle(appPath) {
  if (!appPath) return [];
  const out = await exec('pgrep', ['-f', `${appPath}/Contents/`]);
  return out.split(/\s+/).filter(Boolean).map(Number).filter(p => p !== process.pid);
}

/** Ask processes to close, like clicking X (Windows: taskkill; macOS: "quit" to the app, then SIGTERM). */
export async function askToClose(pids, { appName } = {}) {
  if (IS_MAC) {
    if (appName) await exec('osascript', ['-e', `quit app "${appName.replace(/"/g, '')}"`]);
    else for (const p of pids) try { process.kill(p, 'SIGTERM'); } catch {}
    return;
  }
  if (pids.length) await exec('taskkill', pids.flatMap(p => ['/PID', String(p)]));
}
/** End processes that didn't close when asked. */
export async function forceClose(pids) {
  if (IS_MAC) { for (const p of pids) try { process.kill(p, 'SIGKILL'); } catch {} return; }
  if (pids.length) await exec('taskkill', ['/F', ...pids.flatMap(p => ['/PID', String(p)])]);
}

// ---- Finding apps on macOS -----------------------------------------------------------------------
const MAC_APP_DIRS = () => ['/Applications', join(homedir(), 'Applications')];

/** An .app's bundle id (Contents/Info.plist), or null. */
export function macBundleId(appPath) {
  try { return execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}

/**
 * The app: the first .app by one of these names (in /Applications or ~/Applications) whose bundle id is
 * one of these (names alone mislead: on macOS the Codex app is called "ChatGPT.app", next to OpenAI's
 * other app, also "ChatGPT"), else found by bundle id through Spotlight.
 */
export function findMacApp(names, bundleIds = []) {
  for (const dir of MAC_APP_DIRS()) {
    for (const n of names) {
      const p = join(dir, `${n}.app`);
      if (existsSync(p) && (!bundleIds.length || bundleIds.includes(macBundleId(p)))) return p;
    }
  }
  // Spotlight knows every app by its bundle id, wherever it was put.
  for (const id of bundleIds) {
    try {
      const hit = execFileSync('mdfind', [`kMDItemCFBundleIdentifier == "${id}"`], { encoding: 'utf8' }).split('\n').find(l => l.endsWith('.app'));
      if (hit) return hit;
    } catch {}
  }
  return null;
}
/** The program inside an .app bundle (Contents/MacOS/<CFBundleExecutable>). */
export function macExecutable(appPath) {
  if (!appPath) return null;
  try {
    const name = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
    if (name) return join(appPath, 'Contents', 'MacOS', name);
  } catch {}
  try { const files = readdirSync(join(appPath, 'Contents', 'MacOS')); if (files[0]) return join(appPath, 'Contents', 'MacOS', files[0]); } catch {}
  return null;
}
/** An .app's display name, for AppleScript ("quit app ..."): its file name without ".app". */
export const macAppName = appPath => appPath ? appPath.split('/').pop().replace(/\.app$/, '') : null;
