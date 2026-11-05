// Pet mode: the avatar in its own small see-through window, floating on the desktop. One window per
// app that has pet mode on (Doubao, Codex), all in this one program.
//
// Started and stopped by the background watcher (watcher.mjs, via pet-host.mjs), never on its own.
// The two talk over Node's parent-child message channel (an unnamed pipe only these two processes
// hold): no network port. Piped stdin doesn't reach Electron's main process on Windows, so that
// channel is used instead. When the watcher goes away, the channel closes and the pet quits.
//
// What the pet shows comes from the watcher as small messages (which expert, which topic, whether
// the AI is thinking / writing / done). It never sees chat text.
//
// Security: the window shows only this folder's page and the mods' clips, through a private pet://
// address (nothing from the internet, no file:// access). Its page runs sandboxed, isolated from the
// helper script, without Node, without DevTools, and every permission request is refused.
//
// Graphics card off: we measured a small transparent window looping our clips. With the graphics
// card on, processor use was the same (< 1%; the transparent video is decoded on the processor
// either way) and memory was ~140 MB higher (410 vs 265 MB, mostly the graphics process). So the
// pet draws in software.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, screen, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!process.send) { console.error('Pet mode is started by the mods watcher (watcher.mjs --watch), not directly.'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'mods', 'media');
const PAGE_FILES = {
  'index.html': path.join(__dirname, 'index.html'), 'payload.js': path.join(__dirname, 'build', 'payload.js'),
  'menu.html': path.join(__dirname, 'menu.html'), 'menu.js': path.join(__dirname, 'menu.js'),   // the right-click menu
  'ring.html': path.join(__dirname, 'ring.html'), 'ring.js': path.join(__dirname, 'ring.js'),   // Claude's rainbow chat box
};
const MEDIA_NAME = /^[a-z0-9_-]+\.webm$/i;

app.disableHardwareAcceleration();
// macOS: no Dock icon for the pet program (her windows float on their own).
if (process.platform === 'darwin') app.dock?.hide();
// If the graphics process can't start sandboxed (some virtual-display drivers), the watcher restarts
// the pet once with this flag; it is logged, and everyone else keeps the sandbox.
if (process.argv.includes('--no-gpu-sandbox')) app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const send = msg => { try { process.send(msg); } catch {} };
process.on('disconnect', () => app.exit(0));   // the watcher is gone: so is the pet
// An unexpected error goes to the watcher's log (mods-log.txt) instead of an error box nobody sees
// (a hidden pet program can't show one), and the pet keeps running.
process.on('uncaughtException', e => send({ type: 'log', app: '', text: `error: ${String(e?.stack || e).slice(0, 400)}` }));

// Window size (DIP): room for her (170 x 239) plus the topic bubble above, the thought cloud and the
// sparkles beside her. The page puts her at the bottom centre.
const W = 320, H = 340;
const startedAt = Date.now();

// One pet window per app that has pet mode on (the watcher says which: open / close).
const pets = new Map();   // appId -> { app, label, slot, win, interactive, drag, state }
const petOf = e => {      // the pet whose page sent this message (only our own pages count)
  if (!e.senderFrame || !e.senderFrame.url.startsWith('pet://app/')) return null;
  const w = BrowserWindow.fromWebContents(e.sender);
  for (const p of pets.values()) if (p.win === w) return p;
  return null;
};

function visibleArea(x, y) {
  return screen.getDisplayMatching({ x, y, width: W, height: H }).workArea;
}
// Keep the whole window on a screen (after a drag, a monitor change or a saved spot off-screen).
// She stands at the bottom of her window (170 x 239, 6 px up); the see-through space above her head is
// for her thought bubble. Dragged to the top, that space may go off the screen, so her head can reach
// the top edge (it used to stop about an inch below it: the window's top stayed on the screen).
const ABOVE_HEAD = H - 239 - 6 - 4;
function clampToScreen(x, y) {
  const a = visibleArea(x, y);
  return { x: Math.round(Math.min(Math.max(x, a.x - 60), a.x + a.width - W + 60)),
           y: Math.round(Math.min(Math.max(y, a.y - ABOVE_HEAD), a.y + a.height - H + 20)) };
}
// Bottom-right corner of the main screen; each app has its own slot, side by side, so two pets
// don't start on top of each other.
function defaultSpot(slot = 0) {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - (W + 24) * (slot + 1), y: a.y + a.height - H };
}

// Always set position and size together: at fractional display scaling (e.g. 125%) a position-only
// move makes Windows round the window a pixel or two bigger each time, which added up during a drag
// (measured: 324x345 -> 364x383 in one drag).
function moveTo(p, x, y) {
  p.win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
}

function setInteractive(p, on) {
  if (on === p.interactive) return;
  p.interactive = on;
  // Click-through everywhere except on her: the page tells us when the cursor is over her.
  p.win.setIgnoreMouseEvents(!on);
}

// docked: the pet stands on its app's window and moves with it (Claude: the watcher's window helper,
// pet\claude-dock.cs, places her, keeps her just above Claude's window, and drags her), so it isn't
// always on top, and her corners are the app window's.
function openPet({ app: id, label, spot, slot, docked = false }) {
  if (pets.has(id)) return;
  const s = spot && Number.isFinite(spot.x) && Number.isFinite(spot.y) ? spot : defaultSpot(slot);
  const pos = clampToScreen(s.x, s.y);
  const win = new BrowserWindow({
    x: pos.x, y: pos.y, width: W, height: H, useContentSize: true,
    transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: !docked,
    focusable: false, show: false, title: `Avatar pet - ${label}`,
    // macOS keeps a window's top below the menu bar; this lets her see-through top go above it, so
    // she can be dragged right up to the top of the screen (no effect on Windows).
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      devTools: false, spellcheck: false, navigateOnDragDrop: false, backgroundThrottling: false,
    },
  });
  const p = { app: id, label: String(label), slot, win, interactive: false, drag: null, state: null, docked: !!docked };
  pets.set(id, p);
  win.setMinimumSize(W, H);
  win.setMaximumSize(W, H);
  if (!docked) win.setAlwaysOnTop(true, 'floating');
  // macOS: on every desktop (Space), and over full-screen apps too, as a Windows always-on-top window is.
  if (!docked && process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  // The page may only ever be our own page.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (e, d) => {
    send({ type: 'log', app: id, text: `page stopped (${d.reason}), reloading` });
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 1000);
  });
  // A docked pet is shown by the helper once it knows where her app's window is.
  if (docked) send({ type: 'hwnd', app: id, hwnd: String(win.getNativeWindowHandle().readUInt32LE(0)) });
  else win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { if (pets.get(id) === p) pets.delete(id); });
  // The page shows which app she belongs to (name tag on hover).
  win.loadURL(`pet://app/index.html?label=${encodeURIComponent(p.label)}${docked ? '&docked=1' : ''}`);
}

// ---- Claude's rainbow chat box ----
// A see-through window that ignores the mouse, laid over Claude's chat box by the watcher's window
// helper (which gets its handle, and sizes and places it); it shows the rainbow edge and glow
// (ring.html). Shown only while the watcher says so: ring on, Claude's window showing, its chat box found.
const rings = new Map();   // appId -> { win, state }
function ringFor(id) {
  let r = rings.get(id);
  if (r && !r.win.isDestroyed()) return r;
  const win = new BrowserWindow({
    x: -32000, y: -32000, width: 200, height: 100, show: false, transparent: true, backgroundColor: '#00000000',
    // resizable (with no resize border): the window helper sizes it to the chat box
    frame: false, resizable: true, thickFrame: false, maximizable: false, minimizable: false, fullscreenable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, title: 'Rainbow chat box',
    webPreferences: {
      preload: path.join(__dirname, 'ring-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      devTools: false, spellcheck: false, navigateOnDragDrop: false, backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(true);   // always: clicks go through to Claude's chat box
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  r = { win, state: null };
  rings.set(id, r);
  win.webContents.on('did-finish-load', () => { if (r.state) win.webContents.send('ring:state', r.state); });
  win.on('closed', () => { if (rings.get(id) === r) rings.delete(id); });
  win.loadURL('pet://app/ring.html');
  send({ type: 'ringHwnd', app: id, hwnd: String(win.getNativeWindowHandle().readUInt32LE(0)) });
  return r;
}
function setRing({ app: id, visible, dark, busy, radius }) {
  const r = visible ? ringFor(id) : rings.get(id);
  if (!r || r.win.isDestroyed()) return;
  r.state = { dark: !!dark, busy: !!busy, radius: Number(radius) || 18 };
  r.win.webContents.send('ring:state', r.state);
  if (visible && !r.win.isVisible()) r.win.showInactive();
  if (!visible && r.win.isVisible()) r.win.hide();
}

function closePet(id) {
  const ring = rings.get(id);
  if (ring && !ring.win.isDestroyed()) ring.win.destroy();
  const p = pets.get(id);
  if (!p) return;
  pets.delete(id);
  if (p.drag) clearInterval(p.drag.timer);
  if (!p.win.isDestroyed()) p.win.destroy();
}

// Ask each page, a few times a second while the cursor is over its window, whether it's on her.
// (Polling here keeps working even while the window ignores the mouse.)
setInterval(() => {
  if (!pets.size || !app.isReady()) return;
  const c = screen.getCursorScreenPoint();
  for (const p of pets.values()) {
    if (p.win.isDestroyed() || p.drag) continue;
    const b = p.win.getBounds();
    const inside = c.x >= b.x && c.y >= b.y && c.x < b.x + b.width && c.y < b.y + b.height;
    if (!inside) setInteractive(p, false);
    else p.win.webContents.send('pet:pointer', { x: c.x - b.x, y: c.y - b.y });
  }
}, 30);   // twice as often as before: moving in fast and pressing could beat a 60 ms check

// Some Windows events (display changes, full-screen apps closing) can drop a window out of the
// always-on-top band; check now and then and put her back.
setInterval(() => {
  for (const p of pets.values()) if (!p.docked && !p.win.isDestroyed() && !p.win.isAlwaysOnTop()) p.win.setAlwaysOnTop(true, 'floating');
}, 5000);

// ---- Messages from the pages (through preload.js) ----
ipcMain.on('pet:hit', (e, hit) => { const p = petOf(e); if (p) setInteractive(p, !!hit); });

ipcMain.on('pet:drag', (e, phase) => {
  const p = petOf(e);
  // A docked pet is dragged by the watcher's window helper instead (pet\claude-dock.cs): Electron
  // swallows the press on a window that can't take focus while another app is active, so her page
  // only sees it now and then.
  if (!p || p.docked) return;
  if (phase === 'start') {
    if (p.drag) return;
    const c = screen.getCursorScreenPoint(), [x, y] = p.win.getPosition();
    p.drag = { cx: c.x, cy: c.y, x, y, timer: setInterval(() => {
      const q = screen.getCursorScreenPoint();
      moveTo(p, p.drag.x + q.x - p.drag.cx, p.drag.y + q.y - p.drag.cy);
    }, 16) };
    setInteractive(p, true);
  } else if (p.drag) {
    clearInterval(p.drag.timer);
    p.drag = null;
    if (p.docked) return;
    const [x, y] = p.win.getPosition(), c = clampToScreen(x, y);
    moveTo(p, c.x, c.y);
    send({ type: 'moved', app: p.app, x: c.x, y: c.y });
  }
});

// ---- Right-click menu ----
// The pet's page builds the same menu as in the app (30-avatar.js buildMenu) and sends it here as
// HTML; it's shown in a small menu window of its own (menu.html), since the pet's window only fits
// her. A click there is sent back to the page, which runs that item. The menu window takes focus
// while open (so Esc and a click elsewhere close it); Windows doesn't hand focus back to the window
// you were in afterwards, as with most tray menus: click into it before typing.
let menuWin = null, menuOwner = null;
function closeMenu() {
  const w = menuWin;
  menuWin = menuOwner = null;
  if (w && !w.isDestroyed()) w.destroy();
}
// Each screen corner: where the pet window goes (as far into the corner as clampToScreen allows).
function cornerSpot(p, mode) {
  const [x, y] = p.win.getPosition(), a = visibleArea(x, y);
  return clampToScreen(mode.endsWith('left') ? a.x - 1e4 : a.x + 1e4, mode.startsWith('top') ? a.y - 1e4 : a.y + 1e4);
}
ipcMain.on('pet:menu', (e, m) => {
  const p = petOf(e);
  if (!p || !m || typeof m.html !== 'string' || m.html.length > 3e6) return;
  closeMenu();
  // For "Where she stands": which corner she's in, else where she is on the screen.
  const [x, y] = p.win.getPosition(), a = visibleArea(x, y);
  const corner = p.docked ? (['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(p.placeMode) ? p.placeMode : null)
    : ['bottom-left', 'top-left', 'top-right', 'bottom-right']
      .find(c => { const s = cornerSpot(p, c); return Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4; }) || null;
  const here = { x: (x + W / 2 - a.x) / a.width, y: (y + H - 120 - a.y) / a.height };
  const c = screen.getCursorScreenPoint();
  const win = menuWin = new BrowserWindow({
    x: c.x, y: c.y, width: 340, height: 700, useContentSize: true, show: false,
    transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
    title: `Avatar menu - ${p.label}`,
    webPreferences: {
      preload: path.join(__dirname, 'menu-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      devTools: false, spellcheck: false, navigateOnDragDrop: false,
    },
  });
  menuOwner = p;
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.webContents.on('will-navigate', ev => ev.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('blur', () => { if (menuWin === win) closeMenu(); });
  win.webContents.once('did-finish-load', () => win.webContents.send('menu:show', { html: m.html, css: m.css, corner, here }));
  win.loadURL('pet://app/menu.html');
});
const fromMenu = e => menuWin && !menuWin.isDestroyed() && e.sender === menuWin.webContents && e.senderFrame?.url.startsWith('pet://app/');
ipcMain.on('menu:size', (e, s) => {
  if (!fromMenu(e)) return;
  // Open at the cursor, kept on its screen (flipped up or left near the edges).
  const w = Math.min(Math.max(Math.round(s.w), 100), 600), h = Math.min(Math.max(Math.round(s.h), 60), 1200);
  const c = screen.getCursorScreenPoint(), a = screen.getDisplayNearestPoint(c).workArea;
  let x = c.x, y = c.y;
  if (x + w > a.x + a.width) x = Math.max(a.x, c.x - w);
  if (y + h > a.y + a.height) y = Math.max(a.y, a.y + a.height - h);
  menuWin.setBounds({ x, y, width: w, height: h });
  menuWin.show();
  menuWin.focus();
});
ipcMain.on('menu:pick', (e, k) => {
  if (!fromMenu(e) || !Number.isInteger(k)) return;
  const p = menuOwner;
  closeMenu();
  if (p && !p.win.isDestroyed()) p.win.webContents.send('pet:command', { type: 'menu', k });
});
ipcMain.on('menu:close', e => { if (fromMenu(e)) closeMenu(); });

// Menu choices: the app keeps its style and rainbow chat box (the watcher passes them on); moving to
// a corner and leaving pet mode happen here.
ipcMain.on('pet:act', (e, a) => {
  const p = petOf(e);
  if (!p || !a) return;
  if (a.type === 'look' && ['people', 'single', 'fish'].includes(a.value)) send({ type: 'look', app: p.app, look: a.value });
  if (a.type === 'ring') send({ type: 'ring', app: p.app, on: !!a.value });
  if (a.type === 'back') send({ type: 'back', app: p.app });
  if (a.type === 'corner' && p.docked && ['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(a.value)) send({ type: 'place', app: p.app, mode: a.value });
  if (a.type === 'where' && p.docked) send({ type: 'where', app: p.app, where: String(a.value) });   // on the window, in the chat, or free
  if (a.type === 'corner' && !p.docked && ['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(a.value)) {
    const s = cornerSpot(p, a.value);
    moveTo(p, s.x, s.y);
    send({ type: 'moved', app: p.app, x: s.x, y: s.y });
  }
});

ipcMain.on('pet:ready', e => { const p = petOf(e); if (p && p.state) p.win.webContents.send('pet:state', p.state); });

// ---- Messages from the watcher ----
process.on('message', msg => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'open' && typeof msg.app === 'string') openPet(msg);
  if (msg.type === 'close') closePet(msg.app);
  if (msg.type === 'ring' && typeof msg.app === 'string') setRing(msg);
  if (msg.type === 'placed') { const p = pets.get(msg.app); if (p) p.placeMode = String(msg.mode); }   // docked: where she stands
  // A docked pet: its app's window was minimised, moved to another desktop, or came back.
  if (msg.type === 'show') {
    const p = pets.get(msg.app);
    if (p?.docked && !p.win.isDestroyed()) msg.on ? p.win.showInactive() : p.win.hide();
  }
  if (msg.type === 'state') {
    const p = pets.get(msg.app);
    if (!p) return;
    // outfit: a topic id (Doubao, Codex); expert: an expert's name (DeepSeek Harness knows only that).
    p.state = { outfit: msg.outfit ?? null, expert: typeof msg.expert === 'string' ? msg.expert.slice(0, 40) : null, phase: String(msg.phase || 'idle'),
      look: ['people', 'single', 'fish'].includes(msg.look) ? msg.look : null,     // avatar style, from the app
      ring: typeof msg.ring === 'boolean' ? msg.ring : null,                // the app's rainbow chat box
      dark: typeof msg.dark === 'boolean' ? msg.dark : null,                // the app's light/dark theme
      free: msg.free === true,                                              // docked pet set free on the desktop
      where: ['docked', 'chat', 'free'].includes(msg.where) ? msg.where : null };   // ... or in the chat
    p.win.webContents.send('pet:state', p.state);
  }
  if (msg.type === 'reload') for (const p of pets.values()) p.win.webContents.reloadIgnoringCache();   // the mods were edited (skip the cached payload.js)
});

app.on('child-process-gone', (e, d) => {
  // The graphics process failing right at start is the virtual-display-driver case: ask the watcher
  // to restart us once without its sandbox (exit code 75).
  if (d.type === 'GPU' && Date.now() - startedAt < 15000 && !process.argv.includes('--no-gpu-sandbox')) {
    send({ type: 'log', text: `graphics process failed at start (${d.reason}); asking for a restart without its sandbox` });
    app.exit(75);
  }
});

app.whenReady().then(() => {
  // Refuse every permission (camera, microphone, notifications, screen capture, ...).
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // pet://app/ serves exactly these: the pet page and its script, the menu page and its script, and
  // the mods' clips.
  protocol.handle('pet', req => {
    const url = new URL(req.url);
    if (url.host !== 'app') return new Response('not found', { status: 404 });
    const name = decodeURIComponent(url.pathname.slice(1));
    let file = PAGE_FILES[name];
    if (!file && name.startsWith('media/') && MEDIA_NAME.test(name.slice(6))) file = path.join(MEDIA_DIR, name.slice(6));
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  const keepOnScreen = () => { for (const p of pets.values()) { if (p.docked) continue; const [x, y] = p.win.getPosition(), c = clampToScreen(x, y); moveTo(p, c.x, c.y); } };
  screen.on('display-metrics-changed', keepOnScreen);
  screen.on('display-removed', keepOnScreen);
  send({ type: 'started' });   // the watcher now says which pets to open
});

// Closing the last pet window doesn't end the program: the watcher decides when to stop it.
app.on('window-all-closed', () => {});
