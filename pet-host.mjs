// Pet mode, watcher side: per-app settings, starting/stopping the pet program (pet/main.js,
// Electron), and passing each app's avatar state to that app's pet.
//
// Each app has its own switch, off by default: right-click the avatar in Doubao and only Doubao's
// avatar moves to the desktop; Codex keeps its own setting. Each app that's switched on gets its own
// pet window, shown while that app is open. Both windows live in one pet program (shared cost).
// Settings and each pet's spot on the desktop are kept in .pet.json.
//
// The pet program is our child process with a Node message channel (no network port); the in-app
// avatars reach us through a DevTools binding (window.__doubaoPet), like the topic and clip requests.
// Electron lives in pet/node_modules and is only installed when pet mode is first set up.
//
// Docked apps (Claude): no page of ours runs in them, so the watcher itself keeps their avatar state
// (claude-bridge.mjs feeds it from Claude Code hooks) and their style. Their pet stands at the
// bottom-left corner of the app's window: pet\claude-dock.cs (run inside Windows PowerShell, so there's
// no .exe of ours for antivirus tools to quarantine) finds the window, says when it's open, and moves
// the pet's window with it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { tr } from './lang.mjs';

const LOOKS = ['people', 'single', 'fish'];

export function createPetHost({ root, apps, log, onModeChanged, notifyPages }) {
  const PET_DIR = join(root, 'pet');
  const SETTINGS = join(root, '.pet.json');
  // apps: { doubao: { on, spot }, codex: { on, spot } }
  let settings = { apps: {} };
  const app = id => (settings.apps[id] ||= { on: false, spot: null });
  const present = new Set();      // apps with an open window right now
  const missed = Object.fromEntries(Object.keys(apps).map(id => [id, 0]));
  const lastState = {};           // appId -> { outfit, phase }
  const opened = new Set();       // apps whose pet window the pet program was told to open
  let child = null, childReady = false, wanted = false, restarts = 0, noGpuSandbox = false, settingUp = false;

  const electronPath = () => {
    try {
      const p = createRequire(join(PET_DIR, 'package.json'))('electron'); // path to electron.exe
      return typeof p === 'string' && existsSync(p) ? p : null;
    } catch { return null; }
  };
  const save = () => writeFile(SETTINGS, JSON.stringify(settings, null, 2)).catch(() => {});

  async function load() {
    try {
      const s = JSON.parse(await readFile(SETTINGS, 'utf8'));
      if (s.apps && typeof s.apps === 'object') settings = { apps: s.apps };
      // First version: one setting for both apps; it was switched on from Doubao.
      else if (typeof s.on === 'boolean') { settings = { apps: { doubao: { on: s.on, spot: s.spot ?? null } } }; save(); }
    } catch {}
    for (const id of Object.keys(settings.apps)) if (!apps[id]) delete settings.apps[id];
    // A docked app's pet is off until switched on ("Start Claude Avatar.bat", or claude-hook.mjs on).
    for (const [id, a] of Object.entries(apps)) if (a.docked && !settings.apps[id]) settings.apps[id] = { on: false, look: 'people' };
    if (!electronPath()) for (const a of Object.values(settings.apps)) a.on = false; // not set up here
    for (const [id, a] of Object.entries(apps)) if (a.docked) {
      // ring: its rainbow chat box (pet\ring.html over the app's chat box), on unless switched off.
      lastState[id] = { outfit: null, phase: 'idle', look: app(id).look || 'people', ring: app(id).ring !== false, dark: null, free: isFree(id), where: whereOf(id) };
      if (app(id).on) startDock(id);   // the window helper runs only while that app's pet is on
    }
  }

  // ---- Docked apps: the window helper ----
  const docks = {};   // appId -> helper process
  // The ring's corner radius in DIPs, so its corners follow the chat box's: Claude 18. Kimi 24: its
  // box border's corners are 23.2 DIPs (circles fitted to the grey border on a screen capture), and
  // the ring runs ~1.2 DIPs outside the border, so the same gap holds around the corners.
  const RING_RADIUS = { claude: 18, kimi: 24 };
  const showDocked = {};   // appId -> whether its window is on screen (so its pet shows)
  const boxDocked = {};    // appId -> whether its chat box was found (so its rainbow ring can show)
  // The rainbow ring window: shown while it's on, the pet is open, the app's window is on screen and
  // its chat box was found; it turns faster while the app answers, and glows more on a dark page.
  function updateRing(id) {
    if (!apps[id]?.docked || !child || !childReady) return;
    const s = lastState[id] || {};
    const visible = app(id).on && s.ring !== false && opened.has(id) && !!showDocked[id] && !!boxDocked[id];
    child.send({ type: 'ring', app: id, visible, dark: !!s.dark, busy: s.phase === 'thinking' || s.phase === 'writing', radius: RING_RADIUS[id] ?? 18 });
  }
  function startDock(id) {
    if (docks[id] || !electronPath()) return;
    if (process.platform !== 'win32') return;   // the window helper is Windows-only (macOS: to come)
    const src = join(PET_DIR, 'claude-dock.cs');
    if (!existsSync(src)) return;
    const p = docks[id] = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -Path '${src.replace(/'/g, "''")}' -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase; [ClaudeDock]::Run('${id === 'kimi' ? 'kimi' : 'claude'}')`],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    p.on('error', e => log(`${apps[id].name} pet: window helper unavailable (${e.message}).`));
    p.stdin.on('error', () => {});
    dockSay(id, placeLine(id));
    createInterface({ input: p.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (typeof m.dark === 'boolean') return setDockedState(id, { dark: m.dark });   // its light/dark theme
      // What the app is doing in its window (a sent prompt, Stop showing, another chat opened): for
      // claude-bridge.mjs / kimi-bridge.mjs.
      if (typeof m.prompt === 'string' || typeof m.busy === 'boolean' || typeof m.chat === 'string') { for (const fn of dockListeners) fn(id, m); return; }
      if (m.placed?.mode === 'free' && Number.isFinite(m.placed.x) && Number.isFinite(m.placed.y)) {   // free: where she is now
        app(id).place = { mode: 'free', x: m.placed.x, y: m.placed.y }; save();
        if (opened.has(id)) child?.send({ type: 'placed', app: id, mode: 'free' });
        return;
      }
      if (m.placed?.mode === 'custom' && Number.isFinite(m.placed.fx) && Number.isFinite(m.placed.fy)) {   // dropped after a drag
        app(id).place = { mode: 'custom', fx: m.placed.fx, fy: m.placed.fy }; save();
        if (opened.has(id)) child?.send({ type: 'placed', app: id, mode: 'custom' });
        return;
      }
      if (typeof m.show === 'boolean') { showDocked[id] = m.show; if (opened.has(id)) child?.send({ type: 'show', app: id, on: m.show }); updateRing(id); return; }
      if (typeof m.box === 'boolean') { boxDocked[id] = m.box; updateRing(id); return; }
      if (typeof m.claude !== 'boolean') return;
      if (m.claude) present.add(id); else present.delete(id);
      log(`${apps[id].name} window ${m.claude ? 'found' : 'closed'}.`);
      sync();
    });
    p.on('exit', () => { if (docks[id] === p) { delete docks[id]; present.delete(id); sync(); } });
  }
  function stopDock(id) {
    const p = docks[id];
    if (!p) return;
    delete docks[id];
    present.delete(id);
    showDocked[id] = false;
    try { p.kill(); } catch {}
  }
  const dockSay = (id, line) => { try { docks[id]?.stdin.write(line + '\n'); } catch {} };
  // Where a docked pet stands: beside the chat box (bottom-left), another corner of the app's chat
  // area, or where she was dragged (fractions of the app's window).
  // ... or free on the desktop (mode 'free'): her window's screen spot { x, y } or a screen corner,
  // always on top and not following the app (like the other apps' pets).
  const placeLine = id => {
    const pl = app(id).place;
    if (pl?.mode === 'chat') return 'place chat';   // in the chat, beside Claude's newest reply
    if (pl?.mode === 'free') {
      return Number.isFinite(pl.x) && Number.isFinite(pl.y) ? `place free ${Math.round(pl.x)} ${Math.round(pl.y)}`
        : ['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(pl.corner) ? `place free-corner ${pl.corner}${pl.main ? ' main' : ''}` : 'place free';
    }
    return pl?.mode === 'custom' && Number.isFinite(pl.fx) && Number.isFinite(pl.fy) ? `place custom ${pl.fx} ${pl.fy}`
      : `place ${['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(pl?.mode) ? pl.mode : 'bottom-left'}`;
  };
  const isFree = id => app(id).place?.mode === 'free';
  // Where a docked app's pet is: 'docked' (on its window), 'chat' (in the chat, beside the newest
  // reply: Claude's chat-avatar mod keeps a space there) or 'free' (on the desktop).
  const whereOf = id => (app(id).place?.mode === 'chat' ? 'chat' : isFree(id) ? 'free' : 'docked');
  function setWhere(id, where) {
    if (!apps[id]?.docked || !['docked', 'chat', 'free'].includes(where)) return;
    // Set free: to the bottom-right corner of the main screen (by the taskbar's clock), where the other
    // apps' pets start too.
    app(id).place = where === 'free' ? { mode: 'free', corner: 'bottom-right', main: true } : where === 'chat' ? { mode: 'chat' } : { mode: 'bottom-left' };
    save();
    dockSay(id, placeLine(id));
    child?.send({ type: 'placed', app: id, mode: app(id).place.mode });
    setDockedState(id, { free: where === 'free', where });
    log(`${apps[id].name} pet: ${where === 'free' ? 'free on the desktop' : where === 'chat' ? 'in the chat' : 'on its window'}.`);
  }
  const dockListeners = [];   // claude-bridge.mjs, kimi-bridge.mjs: each picks its own app's events

  // Which pet windows should be showing: switched on, and the app is open.
  const shown = () => Object.keys(apps).filter(id => app(id).on && present.has(id));

  // Bring the pet program and its windows in line with shown().
  function sync() {
    const want = shown();
    if (!want.length || !electronPath()) return stopProgram();
    if (!child) return startProgram();   // it opens the windows once it has started
    if (!childReady) return;             // still starting: 'started' brings us back here
    for (const id of [...opened]) if (!want.includes(id)) { child.send({ type: 'close', app: id }); opened.delete(id); }
    want.forEach(id => {
      if (opened.has(id)) return;
      child.send({ type: 'open', app: id, label: apps[id].name, spot: app(id).spot, slot: Object.keys(apps).indexOf(id), docked: !!apps[id].docked });
      opened.add(id);
      if (lastState[id]) child.send({ type: 'state', app: id, ...lastState[id] });
      if (apps[id].docked) {
        child.send({ type: 'show', app: id, on: !!showDocked[id] });
        child.send({ type: 'placed', app: id, mode: app(id).place?.mode || 'bottom-left' });
        updateRing(id);
      }
    });
  }

  function startProgram() {
    const exe = electronPath();
    if (!exe || child) return;
    wanted = true;
    childReady = false;
    opened.clear();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // must not be set, or Electron runs as plain Node
    const args = [PET_DIR];
    if (noGpuSandbox) args.push('--no-gpu-sandbox');
    child = spawn(exe, args, { cwd: PET_DIR, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    const me = child;
    child.stderr.on('data', () => {}); // Chromium's own noise; not useful in mods-log.txt
    child.on('message', msg => onPetMessage(msg));
    child.on('exit', code => {
      if (child === me) { child = null; opened.clear(); }
      if (!wanted) return;
      if (code === 75 && !noGpuSandbox) {           // graphics process couldn't start sandboxed
        noGpuSandbox = true;
        log('Pet: restarting with the graphics sandbox off (this PC needs it).');
        return startProgram();
      }
      if (++restarts > 3) { log(`Pet stopped (exit ${code}) too often; giving up until it's switched on again.`); return; }
      log(`Pet stopped (exit ${code}); restarting.`);
      setTimeout(() => { if (wanted) startProgram(); }, 1000 * restarts);
    });
    log('Pet program started.');
  }

  function stopProgram() {
    wanted = false;
    opened.clear();
    if (child) { try { child.kill(); } catch {} child = null; log('Pet program stopped (no pet to show).'); }
  }

  function onPetMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'started') { restarts = 0; childReady = true; sync(); }
    if (msg.type === 'log') return log(`Pet${msg.app ? ` (${msg.app})` : ''}: ` + String(msg.text).slice(0, 400));
    if (!apps[msg.app]) return;
    const docked = !!apps[msg.app].docked;
    if (msg.type === 'hwnd' && docked && /^\d{1,10}$/.test(msg.hwnd)) dockSay(msg.app, `pet ${msg.hwnd}`);
    if (msg.type === 'ringHwnd' && docked && /^\d{1,10}$/.test(msg.hwnd)) dockSay(msg.app, `ring ${msg.hwnd}`);
    // A docked pet being dragged (the helper lets go of her, then keeps her where she's dropped), or
    // sent to a corner from her menu.
    if (msg.type === 'hold' && docked) dockSay(msg.app, `hold ${msg.on ? 1 : 0}`);
    if (msg.type === 'place' && docked && ['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(msg.mode)) {
      // A corner: of the screen while she's free, else of the app's window.
      app(msg.app).place = isFree(msg.app) ? { mode: 'free', corner: msg.mode } : { mode: msg.mode }; save();
      dockSay(msg.app, placeLine(msg.app));
      child?.send({ type: 'placed', app: msg.app, mode: msg.mode });
    }
    // On the app's window, in the chat, or free on the desktop (her menu).
    if (msg.type === 'where' && docked) setWhere(msg.app, msg.where);
    if (msg.type === 'moved' && !docked && Number.isFinite(msg.x) && Number.isFinite(msg.y)) { app(msg.app).spot = { x: msg.x, y: msg.y }; save(); }
    if (msg.type === 'back') setMode(msg.app, false);
    // From the pet's menu: settings the app's page keeps (it then tells the pet the new state); a
    // docked app has no page of ours, so its style is kept here.
    if (msg.type === 'ring') {
      if (!docked) notifyPages(msg.app, { ring: !!msg.on });
      else { app(msg.app).ring = !!msg.on; save(); setDockedState(msg.app, { ring: !!msg.on }); }
    }
    if (msg.type === 'look' && LOOKS.includes(msg.look)) {
      if (!docked) notifyPages(msg.app, { look: msg.look });
      else { app(msg.app).look = msg.look; save(); setDockedState(msg.app, { look: msg.look }); }
    }
  }

  // A docked app's avatar state, from claude-bridge.mjs (topic, phase) or its pet's menu (style).
  function setDockedState(appId, change) {
    if (!apps[appId]?.docked) return;
    lastState[appId] = { ...lastState[appId], ...change };
    if (opened.has(appId)) child?.send({ type: 'state', app: appId, ...lastState[appId] });
    updateRing(appId);
  }

  async function setMode(appId, on) {
    if (!apps[appId]) return;
    if (on && !electronPath()) return notifyPages(appId, { error: tr('Pet mode needs a one-time setup first.', '宠物模式需要先进行一次性安装。') });
    if (app(appId).on !== on) {
      app(appId).on = on;
      if (on) restarts = 0;
      save();
      log(`Pet mode ${on ? 'on' : 'off'} for ${apps[appId].name}.`);
      onModeChanged(appId); // re-inject that app, so its in-app avatar hides or comes back
    }
    if (apps[appId].docked) on ? startDock(appId) : stopDock(appId);
    sync();
  }

  // One-time setup on a PC without Electron: npm install in pet/ (downloads Electron, ~160 MB).
  async function setup(appId) {
    if (electronPath()) return setMode(appId, true);
    if (settingUp) return;
    settingUp = true;
    notifyPages(appId, { busy: true, status: tr('Setting up pet mode (one-time download)…', '正在安装宠物模式（一次性下载）…') });
    log('Pet mode: installing Electron in pet/ (one-time)...');
    await mkdir(PET_DIR, { recursive: true }).catch(() => {});
    const ok = await new Promise(resolve => {
      const p = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: PET_DIR, shell: true, windowsHide: true, stdio: 'ignore' });
      p.on('exit', code => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    settingUp = false;
    if (!ok || !electronPath()) {
      log('Pet mode setup failed (npm install in pet/).');
      return notifyPages(appId, { error: tr('Pet mode setup failed. Check your internet connection and try again.', '宠物模式安装失败。请检查网络连接后重试。') });
    }
    log('Pet mode: Electron installed.');
    setMode(appId, true);
  }

  // window.__doubaoPet(json) from an in-app avatar.
  function fromPage(appId, payload) {
    if (!apps[appId]) return;
    let msg;
    try { msg = JSON.parse(payload); } catch { return; }
    if (msg.type === 'state') {
      // Only what the pet needs: which topic (decides the expert), the answer phase, and the avatar
      // style (different people, or one person changing outfits).
      lastState[appId] = {
        outfit: typeof msg.outfit === 'string' ? msg.outfit.slice(0, 40) : null,
        phase: ['idle', 'thinking', 'writing'].includes(msg.phase) ? msg.phase : 'idle',
        look: ['people', 'single', 'fish'].includes(msg.look) ? msg.look : null,
        ring: typeof msg.ring === 'boolean' ? msg.ring : null, // the app's rainbow chat box (for the pet's menu)
        dark: typeof msg.dark === 'boolean' ? msg.dark : null, // the app's theme (the pet's bubbles match it)
      };
      if (opened.has(appId)) child?.send({ type: 'state', app: appId, ...lastState[appId] });
    }
    if (msg.type === 'mode') setMode(appId, !!msg.on);
    if (msg.type === 'setup') setup(appId);
  }

  return {
    load,
    // What an app's in-app avatar is told on every injection (as PET).
    pageInfo: appId => ({ on: !!settings.apps[appId]?.on, available: !!electronPath() }),
    // Which apps have a window open (from the watcher's regular check); a pet shows only while its
    // app is open.
    // An app counts as closed only after two checks in a row miss it (one slow answer from a busy
    // app shouldn't make its pet blink away).
    setPresent: ids => {
      const before = [...present].sort().join();
      for (const id of Object.keys(apps)) {
        if (apps[id].docked) continue;   // their window helper says when they're open
        if (ids.has(id)) { present.add(id); missed[id] = 0; }
        else if (++missed[id] >= 2) present.delete(id);
      }
      if ([...present].sort().join() !== before) sync();
    },
    fromPage,
    setDockedState,
    dockedState: id => lastState[id] || null,
    // claude-bridge.mjs hears what the window helper sees in the app (a sent prompt, Stop showing).
    onDockEvent: fn => { dockListeners.push(fn); },
    // The avatar style of a docked app (from its pet's menu, or the avatar pane mod in Claude).
    setWhere,
    setDockedLook: (id, look) => { if (apps[id]?.docked && LOOKS.includes(look)) { app(id).look = look; save(); setDockedState(id, { look }); } },
    setMode,
    // Whether a docked app's pet is on and its window is open (keeps the watcher running).
    dockedOpen: () => Object.keys(apps).some(id => apps[id].docked && app(id).on && present.has(id)),
    // The docked apps whose pet is switched on, window open or not (Claude, Kimi).
    dockedOn: () => Object.keys(apps).filter(id => apps[id].docked && app(id).on),
    modsChanged: () => child?.send({ type: 'reload' }),
    stop: () => { stopProgram(); for (const p of Object.values(docks)) try { p.kill(); } catch {} },
    petDir: PET_DIR,
  };
}
