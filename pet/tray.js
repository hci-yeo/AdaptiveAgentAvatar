// AI Avatar tray icon: the avatar's control centre in the notification area (by the clock).
// It runs on the pet program's Electron (same install), as its own small process with no windows.
//
// - Shows, per app, whether the avatar is on; opens Doubao / Codex / Yuanbao with the avatar
//   (through launch.mjs, the same launcher the Start files use). Also, when installed: Claude and
//   Kimi (their overlay on or off: launch.mjs claude|kimi, claude-hook.mjs off) and DeepSeek Harness
//   (opens it, adding the avatar plugin first if needed: tools/dsh-plugin.mjs --start).
// - Restarts the background watcher (watcher.mjs --watch) if it crashes while an app still has the
//   avatar. Three crashes within 10 minutes: it stops trying and says so.
// - Restart avatar, Turn avatar off / back on, Start with Windows, Open log, Exit (turns the avatar
//   off everywhere, like "Turn avatar off", then closes the icon; a Start file brings it all back).
//
// Started by launch.mjs (the Start files); one copy only. It's separate from the pet windows
// (pet/main.js), which the watcher starts and owns, so the tray can restart the watcher without
// taking the pets down with it.
//
// Files it shares with the rest of the mods (in the project folder):
//   .watcher.pid   the watcher's process id (watcher.mjs writes it as soon as it starts)
//   .watcher.stop  created here to ask the watcher to quit; it checks every 2 s, deletes it and exits
//   .mods-off      "turned off on purpose": no automatic restart. Turn Avatar Off.bat and "Turn avatar
//                  off" create it; the Start files and "Turn avatar back on" delete it.
//   mods-log.txt   the watcher's log; the one from before an automatic restart is kept as
//                  mods-log.previous.txt
//   .tray.stop     Uninstall.bat asks the tray to quit (it then exits as with Exit)
//
// Language: English or Chinese (pet/tray-text.js), chosen in the menu (Language / 语言) and kept in the
// tray's settings folder (settings.json). Until chosen, it follows Windows' display language.
//
// Testing: electron pet/tray.js --dump-menu=<file> [--lang=en|zh] writes the menu as it would show now,
// then exits.
'use strict';
const { app, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { LANGS, LANGUAGE_NAMES, defaultLang } = require('./tray-text.js');

const ROOT = path.resolve(__dirname, '..');
const ICONS = path.join(__dirname, 'tray-icons');
const STOP_FILE = path.join(ROOT, '.watcher.stop');
const OFF_FLAG = path.join(ROOT, '.mods-off');
const LOG_FILE = path.join(ROOT, 'mods-log.txt');
const TRAY_LOG = path.join(__dirname, 'tray-log.txt');
const TRAY_STOP = path.join(ROOT, '.tray.stop');
const NO_CHATBOX = path.join(ROOT, '.no-chatbox');   // written by the watcher (watcher.mjs): app ids, one per line
const TITLE = 'AI Avatar';
const FEEDBACK_URL = 'https://feedback.adaptive-avatar.online/';   // the survey (feedback-server/ in the dev folder)
// Apps without a debugging port: Claude and Kimi get an overlay (a docked pet, its setting in .pet.json),
// DeepSeek Harness a plugin. Each shows in the menu only when installed.
const LOCAL = process.env.LOCALAPPDATA || '';
const IS_MAC = process.platform === 'darwin';
const PET_SETTINGS = path.join(ROOT, '.pet.json');
// (macOS: the Claude/Kimi overlay helper doesn't exist there yet, so they don't show; see MAC-CHECKLIST.md.)
const DOCKED = IS_MAC ? [] : [
  { id: 'claude', name: 'Claude',   // the desktop app, an app package in WindowsApps (the overlay helper looks for that one)
    installed: () => { try { return fs.readdirSync(path.join(LOCAL, 'Packages')).some(n => /^Claude_/i.test(n)); } catch { return false; } } },
  { id: 'kimi', name: 'Kimi', installed: () => fs.existsSync(path.join(LOCAL, 'Programs', 'Kimi', 'Kimi.exe')) },
];
const DSH_EXE = IS_MAC ? '/Applications/DeepSeek Harness.app'
  : path.join(LOCAL, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe');
// The same profile and check as tools/dsh-plugin.mjs (AVATAR_DSH_PROFILE: another profile, for tests).
const DSH_PROFILE = path.join(os.homedir(), '.dsh', 'profiles', process.env.AVATAR_DSH_PROFILE || 'desktop', 'package.json');
const DSH_LINK = 'link:' + path.join(ROOT, 'integrations', 'deepseek-harness').replace(/\\/g, '/');
const petOn = id => { try { return JSON.parse(fs.readFileSync(PET_SETTINGS, 'utf8')).apps?.[id]?.on === true; } catch { return false; } };
// Added from this folder and switched on (in DSH's bundles): "avatar on (plugin)" only then. Disabled,
// or added from another folder, the menu offers to add it here instead.
const dshPluginHere = () => {
  try {
    const p = JSON.parse(fs.readFileSync(DSH_PROFILE, 'utf8'));
    return p.dependencies?.['@local/ai-avatar'] === DSH_LINK && (p.dsh?.profile?.bundles || []).includes('@local/ai-avatar');
  } catch { return false; }
};
// Is a program running? Windows: by its file name (tasklist). macOS: by its name (pgrep), ".exe" dropped.
const isRunning = image => new Promise(res => IS_MAC
  ? execFile('pgrep', ['-x', image.replace(/\.exe$/i, '')], (e, out) => res(!!String(out || '').trim()))
  : execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { windowsHide: true },
    (e, out) => res(String(out || '').toLowerCase().includes(image.toLowerCase()))));
const DUMP = (process.argv.find(a => a.startsWith('--dump-menu=')) || '').slice('--dump-menu='.length);

app.setName(TITLE);
app.setAppUserModelId('AI Avatar');
// macOS: a menu-bar icon only, no Dock icon or app menu.
if (IS_MAC) app.dock?.hide();
// Its own settings folder, so it never shares one with the pet program.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-avatar-tray'));
app.disableHardwareAcceleration();   // no windows to draw
if (!DUMP && !app.requestSingleInstanceLock()) app.exit(0);

// ---- Language -----------------------------------------------------------------------------------
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const LANG_ARG = (process.argv.find(a => a.startsWith('--lang=')) || '').slice('--lang='.length);   // testing
let lang = 'en';                 // set when the app is ready (Windows' language is known only then)
const T = () => LANGS[lang];     // the text in the current language
// The same choice is read by the avatar in every app (lang.mjs), so it's saved even the first time:
// then they all start in Windows' display language, as the tray does.
function loadLang() {
  if (LANGS[LANG_ARG]) return LANG_ARG;
  try { const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')).lang; if (LANGS[saved]) return saved; } catch {}
  const l = defaultLang(app.getPreferredSystemLanguages?.() || [app.getLocale()]);
  if (!DUMP) saveLang(l);
  return l;
}
function saveLang(l) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify({ lang: l }));
  } catch (e) { trayLog(`settings: ${e.message}`); }
}
// The avatar in open apps follows within a second or two (the background process watches the file).
function setLang(l) {
  if (!LANGS[l] || l === lang) return;
  lang = l;
  saveLang(l);
  trayLog(`language: ${l}`);
  refresh();
}
// An app's name in the current language (豆包, 元宝, 千问 in Chinese).
const nameOf = (id, name) => T().name(id, name);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function trayLog(msg) {
  try {
    if (fs.existsSync(TRAY_LOG) && fs.statSync(TRAY_LOG).size > 200 * 1024) fs.rmSync(TRAY_LOG);
    const t = new Date(), p = n => String(n).padStart(2, '0');   // local time, like mods-log.txt
    const stamp = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
    fs.appendFileSync(TRAY_LOG, `[${stamp}] ${msg}\n`);
  } catch {}
}

let L, APPS, apps = [];                 // launch.mjs, apps.mjs, the installed apps
let docked = [], dshInstalled = false;  // installed overlay apps (DOCKED entries); DeepSeek Harness
let tray;
let exiting = false;   // Exit was chosen: no more icon updates or watcher restarts
const launching = new Map();            // app id -> child process of launch.mjs
let missingTicks = 0, autoRestarts = [], gaveUp = false, sawWatcher = false, lastWatcherStart = 0, lastDockedCheck = 0;

// ---- The watcher --------------------------------------------------------------------------------
function startWatcher({ keepOldLog = false } = {}) {
  for (const f of [STOP_FILE, OFF_FLAG]) fs.rmSync(f, { force: true });
  if (keepOldLog && fs.existsSync(LOG_FILE)) {
    try { fs.copyFileSync(LOG_FILE, path.join(ROOT, 'mods-log.previous.txt')); } catch {}
  }
  const pid = L.startWatcher();
  lastWatcherStart = Date.now();
  trayLog(`watcher started (${pid})`);
}

// Ask it to quit (it checks every 2 s); after 6 s, end it.
async function stopWatcher() {
  const pid = await L.watcherPid();
  if (!pid) return;
  fs.writeFileSync(STOP_FILE, '');
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(200);
  if (alive(pid)) { try { process.kill(pid); } catch {} trayLog('watcher ended (did not stop when asked)'); }
  fs.rmSync(STOP_FILE, { force: true });
  trayLog('watcher stopped');
}

// ---- The avatar in an app's page ----------------------------------------------------------------
// Through the app's local DevTools port, like the watcher: whether she's hidden in that app (her
// right-click menu's "Hide the avatar in this app", or Alt+Shift+H), and showing or hiding her.
// null if the page can't be reached in time.
async function inPage(id, expression) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${APPS[id].port}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    const target = list.find(APPS[id].isTarget);
    if (!target) return null;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    return await new Promise(resolve => {
      const done = v => { clearTimeout(timer); try { ws.close(); } catch {} resolve(v); };
      const timer = setTimeout(() => done(null), 1500);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) done(m.result?.result?.value ?? null); };
      ws.onerror = () => done(null);
    });
  } catch { return null; }
}
const isHiddenIn = id => inPage(id, 'window.__doubaoMods?.avatarHidden?.() ?? null');
async function setHiddenIn(id, hidden) {
  await inPage(id, `window.__doubaoMods?.setAvatarHidden?.(${hidden ? 'true' : 'false'}), true`);
  trayLog(`${id}: avatar ${hidden ? 'hidden' : 'shown'}`);
  refresh();
}

// ---- State --------------------------------------------------------------------------------------
// Per app: closed | open (without the avatar) | on | off (turned off) | stopped (watcher gone) | starting
// `full` also looks at running programs (only when the menu opens; the 4-second check needs ports only).
async function getState(full) {
  // Any watcher, including one started from another copy of this folder (only one can run).
  const watcher = await L.watcherRunning();
  if (watcher) sawWatcher = true;
  const off = fs.existsSync(OFF_FLAG);
  // DeepSeek Harness (only when the menu opens: it looks at running programs). Started now, so it
  // runs alongside the apps' checks (each tasklist takes ~0.3 s).
  const dshRunning = dshInstalled && full && !launching.has('dsh') ? isRunning('DeepSeek Harness.exe') : Promise.resolve(false);
  const list = await Promise.all(apps.map(async id => {
    let status;
    if (launching.has(id)) status = 'starting';
    else if (await L.portOpen(id)) status = off ? 'off' : watcher ? 'on' : 'stopped';
    else if (full) status = (await L.LAUNCH[id].pids()).length ? 'open' : 'closed';
    else status = 'closed';
    // Hidden in that app? (Only when the menu opens: it asks the page.)
    const hidden = full && status === 'on' ? await isHiddenIn(id) === true : false;
    return { id, name: APPS[id].name, status, hidden };
  }));
  // Claude, Kimi: on while the watcher runs (not turned off) and their overlay is switched on.
  const dockedList = docked.map(d => ({ id: d.id, name: d.name,
    status: launching.has(d.id) ? 'starting' : watcher && !off && petOn(d.id) ? 'on' : 'off' }));
  let dsh = null;
  if (dshInstalled) dsh = { status: launching.has('dsh') ? 'starting' : !(await dshRunning) ? 'closed'
    : dshPluginHere() ? 'on' : 'open' };
  return { watcher, off, apps: list, docked: dockedList, dsh };
}

function updateIcon(state) {
  if (exiting || tray.isDestroyed()) return;
  const all = [...state.apps, ...state.docked];
  const s = all.map(a => a.status);
  const look = gaveUp || s.includes('stopped') ? 'problem' : s.includes('starting') ? 'starting' : s.includes('on') ? 'on' : 'idle';
  tray.setImage(nativeImage.createFromPath(path.join(ICONS, `tray-${look}.png`)));
  const onIn = all.filter(a => a.status === 'on').map(a => nameOf(a.id, a.name));
  const t = T(), title = t.title;
  tray.setToolTip(gaveUp ? t.tip.gaveUp(title) : onIn.length ? t.tip.onIn(title, onIn) : state.off ? t.tip.off(title) : t.tip.idle(title));
}

// A short message by the icon (Windows: a balloon; macOS has none, so a notification instead).
const balloon = (content, iconType = 'info') => {
  if (IS_MAC) { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title: T().title, body: content }).show(); return; }
  if (tray && !tray.isDestroyed()) tray.displayBalloon({ title: T().title, content, iconType });
};

// ---- Actions ------------------------------------------------------------------------------------
async function openApp(id, status) {
  const name = nameOf(id, APPS[id].name);
  if (launching.has(id)) return;
  // The menu can be a few seconds old: look again, so an app that was opened since is never
  // restarted without asking.
  status = await L.portOpen(id) ? 'on' : (await L.LAUNCH[id].pids()).length ? 'open' : 'closed';
  if (status === 'open') {
    const t = T();
    const { response } = await dialog.showMessageBox({
      type: 'question', title: t.title, noLink: true, defaultId: 0, cancelId: 1,
      message: t.restartAsk.message(name),
      detail: t.restartAsk.detail(name, t.loses(id)),
      buttons: [t.restartAsk.restart(name), t.restartAsk.cancel],
    });
    if (response !== 0) return;
  }
  // The same launcher as the Start files; it also clears "turned off" and starts the watcher.
  const child = spawn(L.NODE, ['launch.mjs', id, '--yes', '--no-tray'], { cwd: ROOT, env: L.NODE_ENV, windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.on('error', e => { out += e.message; });
  child.on('close', code => {
    launching.delete(id);
    trayLog(`launch ${id} exit ${code}`);
    if (code === 0) { gaveUp = false; autoRestarts = []; balloon(T().balloon.opened(name)); }
    else if (L.noPortNotice && out.includes(L.noPortNotice(id).title)) showNoPort(id);
    else balloon(T().balloon.openFailed(name, out.trim().split(/\r?\n/).pop() || ''), 'error');
    refresh();
  });
  launching.set(id, child);
  trayLog(`launch ${id}`);
  refresh();
}

// The app started, but its debugging port never answered: most likely an update changed it.
function showNoPort(id) {
  const n = L.noPortNotice(id);
  dialog.showMessageBox({ type: 'warning', title: T().title, noLink: true, buttons: [T().ok], message: n.title, detail: `${n.en}\n\n${n.zh}` })
    .catch(e => trayLog(`no-port box: ${e.message}`));
}

// The watcher found an open app whose page never showed its chat box: most likely redesigned in an update.
function showNoChatBox() {
  let ids = [];
  try { ids = fs.readFileSync(NO_CHATBOX, 'utf8').split(/\r?\n/).filter(Boolean); fs.rmSync(NO_CHATBOX, { force: true }); } catch {}
  for (const id of new Set(ids)) {
    if (!APPS?.[id] || !L?.noChatBoxNotice) continue;
    trayLog(`no chat box: ${id}`);
    const n = L.noChatBoxNotice(id);
    dialog.showMessageBox({ type: 'warning', title: T().title, noLink: true, buttons: [T().ok], message: n.title, detail: `${n.en}\n\n${n.zh}` })
      .catch(e => trayLog(`no-chatbox box: ${e.message}`));
  }
}

// Run one of the project's Node tools for a menu line (shown as "starting" meanwhile); done(code, last line).
function runTool(key, args, done) {
  const child = spawn(L.NODE, args, { cwd: ROOT, env: L.NODE_ENV, windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.on('error', e => { out += e.message; });
  child.on('close', code => {
    launching.delete(key);
    trayLog(`${args.join(' ')} exit ${code}`);
    done(code, out.trim().split(/\r?\n/).pop() || '');
    refresh();
  });
  launching.set(key, child);
  refresh();
}

// Claude, Kimi: their overlay on (starting the watcher if needed) or off.
function setDocked(d, on) {
  if (on) runTool(d.id, ['launch.mjs', d.id, '--no-tray'], (code, last) => {
    if (code === 0) { gaveUp = false; balloon(T().balloon.dockedOn(d.name)); }
    else balloon(T().balloon.dockedOnFailed(d.name, last), 'error');
  });
  else runTool(d.id, ['claude-hook.mjs', 'off', ...(d.id === 'kimi' ? ['kimi'] : [])], () => balloon(T().balloon.dockedOff(d.name)));
}

// DeepSeek Harness: open it, adding the avatar plugin first if needed (exit 2: it was already open).
function openDsh() {
  runTool('dsh', ['tools/dsh-plugin.mjs', '--start'], code => {
    if (code === 0) balloon(T().balloon.dshOpening);
    else if (code === 2) balloon(T().balloon.dshAdded);
    else balloon(T().balloon.dshFailed, 'error');
  });
}

async function restartAvatar() {
  await stopWatcher();
  gaveUp = false; autoRestarts = []; missingTicks = 0;
  startWatcher();
  balloon(T().balloon.restarting);
  refresh();
}

// quiet: for Exit (the icon is gone by then, so no notice and no menu refresh).
async function turnOff({ quiet = false } = {}) {
  fs.writeFileSync(OFF_FLAG, '');
  await stopWatcher();
  // Take her out of the open windows (same as Turn Avatar Off.bat).
  await new Promise(res => {
    const p = spawn(L.NODE, ['watcher.mjs', '--off'], { cwd: ROOT, env: L.NODE_ENV, windowsHide: true, stdio: 'ignore' });
    const t = setTimeout(() => { try { p.kill(); } catch {} res(); }, 15000);
    p.on('close', () => { clearTimeout(t); res(); });
    p.on('error', () => { clearTimeout(t); res(); });
  });
  trayLog('avatar turned off');
  if (quiet) return;
  balloon(T().balloon.turnedOff);
  refresh();
}

// Exit: the avatar goes too (in-app avatars, the Claude and Kimi overlays, desktop pets, the
// background process), not just this icon. The icon disappears at once; the rest takes a few seconds.
async function exitAll() {
  exiting = true;
  try { tray.destroy(); } catch {}
  try { await turnOff({ quiet: true }); } catch {}
  trayLog('exit: avatar off, tray closed');
  app.quit();
}

// macOS: Uninstall (a Mac app has no uninstaller; Windows has Uninstall.bat). After you confirm: she's
// turned off everywhere, then the AI Avatar app goes to the Trash (where you can still get it back),
// and her login item, settings, log and the copy she runs from are removed. Chat apps aren't touched.
async function uninstallMac() {
  const zh = lang === 'zh';
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: TITLE, noLink: true, defaultId: 1, cancelId: 1,
    buttons: zh ? ['卸载', '取消'] : ['Uninstall', 'Cancel'],
    message: zh ? '卸载 AI Avatar？' : 'Uninstall AI Avatar?',
    detail: zh ? '她会从所有应用中移除，AI Avatar 应用会移到废纸篓，她的设置和日志会被删除。你的聊天应用不受影响。'
      : 'She’s removed from every app, the AI Avatar app moves to the Trash, and her settings and log are deleted. Your chat apps aren’t affected.',
  });
  if (response !== 0) return;
  exiting = true;
  try { tray.destroy(); } catch {}
  try { await turnOff({ quiet: true }); } catch {}
  try { setStartAtLogin(false); } catch {}
  // The app: the one she was started from (launch.sh writes its place), and any in Applications.
  const apps = new Set(['/Applications/AI Avatar.app', path.join(os.homedir(), 'Applications', 'AI Avatar.app')]);
  try { apps.add(fs.readFileSync(path.join(ROOT, '.app-path'), 'utf8').trim()); } catch {}
  for (const p of apps) {
    if (!p.endsWith('.app') || !fs.existsSync(p)) continue;
    try { await shell.trashItem(p); trayLog(`uninstall: ${p} moved to the Trash`); } catch (e) { trayLog(`uninstall: ${p}: ${e.message}`); }
  }
  for (const dir of ['ai-avatar-tray', 'doubao-mods-pet']) {
    try { fs.rmSync(path.join(app.getPath('appData'), dir), { recursive: true, force: true }); } catch {}
  }
  // The copy she runs from (when started from the app), last: it's this very folder.
  const copy = path.join(app.getPath('appData'), 'AI Avatar');
  if (ROOT.startsWith(copy + path.sep)) { try { fs.rmSync(copy, { recursive: true, force: true }); } catch {} }
  app.exit(0);
}

// Start with Windows: Windows' own "run at sign-in" list, for this tray only.
// macOS: Electron's login item can't pass this script to Electron (its args are Windows-only), so
// there it's a per-user LaunchAgent that starts this folder's Electron with this script at login.
const loginItem = () => ({ path: process.execPath, args: [__filename] });
const LAUNCH_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'online.adaptive-avatar.tray.plist');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const startsWithWindows = () => IS_MAC ? fs.existsSync(LAUNCH_AGENT) : app.getLoginItemSettings(loginItem()).openAtLogin;
function setStartAtLogin(on) {
  if (!IS_MAC) return app.setLoginItemSettings({ ...loginItem(), openAtLogin: on });
  if (!on) { try { fs.rmSync(LAUNCH_AGENT, { force: true }); } catch {} return; }
  fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>online.adaptive-avatar.tray</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(__filename)}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
}

// ---- Feedback -----------------------------------------------------------------------------------
// The survey opens in the browser with a random id made once for this PC (so each PC answers once).
// The id is only a random number: nothing about the person or the PC is sent.
function feedbackId() {
  const file = path.join(app.getPath('userData'), 'feedback-id');
  try { const id = fs.readFileSync(file, 'utf8').trim(); if (/^[A-Za-z0-9-]{16,64}$/.test(id)) return id; } catch {}
  const id = require('node:crypto').randomUUID();
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, id); } catch (e) { trayLog(`feedback id: ${e.message}`); }
  return id;
}
function openFeedback() {
  let version = '';
  try { version = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''); } catch {}
  const q = new URLSearchParams({ id: feedbackId(), v: version, lang });
  shell.openExternal(`${FEEDBACK_URL}?${q}`).catch(e => trayLog(`feedback: ${e.message}`));
  trayLog('feedback: survey opened');
}

// ---- Menu (built fresh each time it opens) -------------------------------------------------------
const dot = s => nativeImage.createFromPath(path.join(ICONS, `dot-${s}.png`));

// Every app line reads the same way: the app, the avatar's state there, what a click does
// (pet/tray-text.js). The dot matches the state: green on, grey off or closed.
function menuTemplate(state) {
  const t = T();
  const items = [{ label: t.title, enabled: false }];
  if (!state.apps.length && !state.docked.length && !state.dsh) items.push({ label: t.noApps, enabled: false });
  for (const a of state.apps) {
    const name = nameOf(a.id, a.name);
    const st = a.status === 'on' && a.hidden ? 'hidden' : a.status;
    const click = {
      on: () => setHiddenIn(a.id, true),       // hide her in that app
      hidden: () => setHiddenIn(a.id, false),  // show her again
      off: () => restartAvatar(),              // turned off everywhere: turn back on
      stopped: () => restartAvatar(),
      open: () => openApp(a.id, a.status),     // restart it with the avatar (asks first)
      closed: () => openApp(a.id, a.status),
    }[st];
    const icon = dot(st === 'hidden' ? 'off' : st);
    items.push({ label: t.app[st](name), icon, enabled: st !== 'starting', click });
  }
  for (const d of state.docked) {   // Claude, Kimi: a floating avatar, switched on or off
    items.push(d.status === 'starting' ? { label: t.docked.starting(d.name), icon: dot('starting'), enabled: false }
      : d.status === 'on' ? { label: t.docked.on(d.name), icon: dot('on'), click: () => setDocked(d, false) }
      : { label: t.docked.off(d.name), icon: dot('closed'), click: () => setDocked(d, true) });
  }
  if (state.dsh) {
    const st = state.dsh.status, n = 'DeepSeek Harness';
    items.push(st === 'starting' ? { label: t.dsh.starting(n), icon: dot('starting'), enabled: false }
      : st === 'on' ? { label: t.dsh.on(n), icon: dot('on'), enabled: false }
      : { label: t.dsh[st === 'open' ? 'open' : 'closed'](n), icon: dot(st === 'open' ? 'open' : 'closed'), click: () => openDsh() });
  }
  const anyPort = state.apps.some(a => ['on', 'off', 'stopped'].includes(a.status)) || state.docked.some(d => d.status === 'on');
  items.push(
    { type: 'separator' },
    { label: t.restart, enabled: anyPort && !state.off, click: () => restartAvatar() },
    state.off
      ? { label: t.turnBackOn, enabled: anyPort, click: () => restartAvatar() }
      : { label: t.turnOff, enabled: anyPort, click: () => turnOff() },
    { type: 'separator' },
    { label: IS_MAC ? (lang === 'zh' ? '登录时自动启动' : 'Open at login') : t.startWithWindows, type: 'checkbox', checked: startsWithWindows(),
      click: item => setStartAtLogin(item.checked) },
    // In both languages, so it can be found whichever language is showing.
    { label: t.language, submenu: Object.entries(LANGUAGE_NAMES).map(([id, label]) =>
      ({ label, type: 'radio', checked: lang === id, click: () => setLang(id) })) },
    { label: t.feedback, click: () => openFeedback() },
    { label: t.openLog, click: () => { if (fs.existsSync(LOG_FILE)) shell.openPath(LOG_FILE); } },
    { label: t.exit, click: () => exitAll() },
    ...(IS_MAC ? [{ label: lang === 'zh' ? '卸载 AI Avatar…' : 'Uninstall AI Avatar…', click: () => uninstallMac() }] : []),
  );
  return items;
}

// The menu is handed to Windows ready-made (tray.setContextMenu), so a right-click shows it at once,
// without waiting for this script. Its state looks at running programs (~0.4 s), so it's rebuilt in
// the background: at start, when the pointer reaches the icon, and after anything changes.
// Its app lines can be a few seconds old; openApp checks the app again before acting.
let menuState = null;   // { at, promise }: one state fetch, reused for 3 s
function prefetchState() {
  if (menuState && Date.now() - menuState.at < 3000) return menuState.promise;
  const promise = getState(true);
  const entry = menuState = { at: Date.now(), promise };
  promise.catch(() => { if (menuState === entry) menuState = null; });
  return promise;
}

let menuOpen = false, pendingState = null, appliedFetch = null;
function setMenu(state) {
  if (exiting || tray.isDestroyed()) return;
  if (menuOpen) { pendingState = state; return; }   // don't swap it while it's showing
  updateIcon(state);
  const menu = Menu.buildFromTemplate(menuTemplate(state));
  menu.on('menu-will-show', () => { menuOpen = true; });
  menu.on('menu-will-close', () => {
    menuOpen = false;
    if (pendingState) { const s = pendingState; pendingState = null; setTimeout(() => setMenu(s), 0); }
  });
  tray.setContextMenu(menu);
}
function refreshMenu() {
  const fetch = prefetchState();
  if (fetch === appliedFetch) return;   // this state is already in the menu (or on its way)
  appliedFetch = fetch;
  fetch.then(setMenu, e => trayLog(`menu: ${e.message}`));
}

// Left click (and a second start of the tray): show the ready-made menu too.
function showMenu() {
  if (exiting || tray.isDestroyed()) return;
  tray.popUpContextMenu();
  refreshMenu();
}

// ---- Every 4 seconds: automatic restart, icon --------------------------------------------------
let ticking = false;
async function tick() {
  if (ticking || exiting) return;
  if (fs.existsSync(TRAY_STOP)) {   // Uninstall.bat: quit as with Exit
    try { fs.rmSync(TRAY_STOP, { force: true }); } catch {}
    trayLog('asked to quit (.tray.stop)');
    return exitAll();
  }
  if (fs.existsSync(NO_CHATBOX)) showNoChatBox();
  ticking = true;
  try {
    const state = await getState(false);
    // An app still has its port open (so the avatar should be there), it wasn't turned off,
    // nothing is being opened, and no watcher for two checks in a row.
    const needs = !state.off && state.apps.some(a => a.status === 'stopped') && !launching.size;
    missingTicks = needs && Date.now() - lastWatcherStart > 20000 ? missingTicks + 1 : 0;
    if (missingTicks >= 2 && !gaveUp && !await L.watcherRunning()) {
      missingTicks = 0;
      autoRestarts = autoRestarts.filter(t => Date.now() - t < 10 * 60 * 1000);
      if (autoRestarts.length >= 3) {
        gaveUp = true;
        trayLog('watcher keeps stopping; gave up');
        balloon(T().balloon.gaveUp, 'error');
      } else {
        autoRestarts.push(Date.now());
        const wasRunning = sawWatcher;
        startWatcher({ keepOldLog: wasRunning });
        if (wasRunning) balloon(T().balloon.restartedItself, 'warning');
      }
    }
    // Claude, Kimi: their avatar is on but no watcher runs (it left after the app was closed), and the
    // app has started again: start it, so she docks back onto the window. A process list costs ~0.3 s,
    // so this looks at most every 12 s, and only while one of them is switched on.
    if (!state.off && !gaveUp && !launching.size && !await L.watcherRunning()
        && Date.now() - lastWatcherStart > 20000 && Date.now() - lastDockedCheck > 12000) {
      const on = docked.filter(d => petOn(d.id));
      if (on.length) {
        lastDockedCheck = Date.now();
        const results = await Promise.all(on.map(d => L.dockedAppRunning(d.id)));
        const back = on.filter((d, i) => results[i]);
        if (back.length) { trayLog(`${back.map(d => d.name).join(', ')} running without the avatar: starting it`); startWatcher(); }
      }
    }
    updateIcon(state);
  } catch (e) { trayLog(`tick: ${e.message}`); } finally { ticking = false; }
}
const refresh = () => { menuState = null; tick(); refreshMenu(); };   // something changed: rebuild the menu

// ---- Start ------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  L = await import(pathToFileURL(path.join(ROOT, 'launch.mjs')).href);
  ({ APPS } = await import(pathToFileURL(path.join(ROOT, 'apps.mjs')).href));
  for (const id of Object.keys(L.LAUNCH)) if (await L.isInstalled(id)) apps.push(id);
  docked = DOCKED.filter(d => d.installed());
  dshInstalled = fs.existsSync(DSH_EXE);
  lang = loadLang();

  if (DUMP) {   // testing: the menu as it would show now, as text
    const line = (i, pad) => i.type === 'separator' ? `${pad}----`
      : `${pad}${i.label}${i.enabled === false ? '   [disabled]' : ''}${i.checked ? '   [checked]' : ''}`
        + (i.submenu ? '\n' + i.submenu.map(s => line(s, pad + '    ')).join('\n') : '');
    fs.writeFileSync(DUMP, menuTemplate(await getState(true)).map(i => line(i, '  ')).join('\n') + '\n');
    return app.exit(0);
  }

  tray = new Tray(nativeImage.createFromPath(path.join(ICONS, 'tray-idle.png')));
  tray.setToolTip(T().title);
  // left click opens the menu too (right-click: Windows shows it; on macOS any click opens it by itself)
  if (!IS_MAC) tray.on('click', showMenu);
  tray.on('mouse-enter', refreshMenu);   // the pointer reached the icon: bring the menu up to date
  tray.on('mouse-move', refreshMenu);
  refreshMenu();
  setInterval(tick, 4000);
  tick();
  trayLog(`tray started (apps: ${[...apps, ...docked.map(d => d.id), ...(dshInstalled ? ['dsh'] : [])].join(', ')})`);
  // Where the system put the icon (a menu bar that's full can hide it on macOS: then it has no room).
  setTimeout(() => { try { trayLog(`icon at ${JSON.stringify(tray.getBounds())}`); } catch {} }, 3000);
});

app.on('second-instance', () => showMenu());
app.on('before-quit', () => trayLog('tray exited'));
