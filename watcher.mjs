// Inject every mods/*.css and mods/*.js into the chat window(s) of Doubao, Codex and/or Yuanbao (apps.mjs).
//   node watcher.mjs           add the avatar once to every app that is running with its DevTools port
//   node watcher.mjs --watch   inject, keep re-injecting on file save, re-apply after page reloads,
//                             pick up apps as they start, and run the local AI topic model for the
//                             avatar (see classifier.mjs). Exits once no app is open.
//   node watcher.mjs --off     take the avatar out of every app
//   --app doubao|codex        limit any of the above to one app
//   node watcher.mjs --pet-bundle  write pet/build/payload.js for the desktop pet, then exit
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch, watchFile, unlinkSync, statSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTargets, connect } from './cdp.mjs';
import { APPS } from './apps.mjs';
import { createPetHost } from './pet-host.mjs';
import { createClaudeBridge } from './claude-bridge.mjs';
import { createKimiBridge } from './kimi-bridge.mjs';
import { createServer } from 'node:net';
import { WATCHER_LOCK } from './launch.mjs';
import { prepareLock } from './platform.mjs';
import { loadMods as loadModsFrom, PRELUDE, constants, applyBlock, MEDIA_NAME } from './avatar-bundle.mjs';
import { keywordTopicOf } from './topic-rule.mjs';
import { readLang, LANG_FILE } from './lang.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODS_DIR = join(ROOT, 'mods');
// Video clips are too big to embed in the page; the page asks for them one at a time (see answerMedia).
const MEDIA_DIR = join(MODS_DIR, 'media');
const TOPICS_FILE = join(ROOT, 'topics.mjs');
const args = new Set(process.argv.slice(2));
const appArg = process.argv.indexOf('--app') > 0 ? process.argv[process.argv.indexOf('--app') + 1] : null;
if (appArg && !APPS[appArg]) { console.error(`Unknown app "${appArg}". Known: ${Object.keys(APPS).join(', ')}`); process.exit(1); }
const APP_IDS = appArg ? [appArg] : Object.keys(APPS);
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// Which embedding model the topic classifier uses (names in classifier.mjs). Only models that ship in
// models\local\ are tried (EmbeddingGemma, then e5-small cut down to Chinese + English), so nothing is
// ever downloaded: if neither loads, the avatar uses its keyword lists. (DOUBAO_TOPIC_MODEL=e5-small
// picks the full e5-small, which downloads once.)
const TOPIC_MODELS = process.env.DOUBAO_TOPIC_MODEL ? [process.env.DOUBAO_TOPIC_MODEL] : ['gemma-300m', 'e5-small-zh-en'];

// Re-import topics.mjs on every call so edits apply without restarting.
const loadTopics = () => import(pathToFileURL(TOPICS_FILE).href + '?v=' + Date.now());

// The avatar's page code, put together the same way for every app (avatar-bundle.mjs).
const loadMods = () => loadModsFrom(ROOT);

// One self-contained script: tears down the previous injection, then applies the new one.
// Each JS mod may return a cleanup function, which runs on the next re-inject or --off.
// pet: { on, available } (pet-host.mjs). appId 'pet' builds the copy for the desktop pet window.
const PET_PAGE = { pet: true, composer: null };
function buildPayload(mods, enabled = true, appId = 'doubao', petState = { on: false, available: false }) {
  if (!enabled) return `(() => {${PRELUDE}
    return 'mods removed';
  })()`;
  const app = { id: appId, ...(appId === 'pet' ? PET_PAGE : APPS[appId].page) };
  // In the language chosen in the tray (lang.mjs); a change re-applies everything (see --watch below).
  // The app's own pages only: the watcher stays attached to the window's tab, and its script runs on
  // every page that tab loads, so a website other than the app's own (千问 is a browser too; Qwen signs
  // in through Google, Apple or GitHub) is skipped. Its own app pages (doubao://, app://, chrome://...)
  // aren't websites, so they always count.
  return `(() => {${PRELUDE}${constants(mods, app, petState, readLang())}
    if (/^https?:$/.test(location.protocol) && !(APP.ownSites || []).includes(location.host)) return 'skipped (not ' + APP.id + "'s own site)";
    const apply = () => {${applyBlock(mods, 'doubao-mods')}};
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', apply, { once: true }) : apply();
    return 'mods applied';
  })()`;
}

// ---- Local AI topic classifier (watch mode only) ----------------------------------------------
// The page asks by calling window.__doubaoTopic(json), a DevTools "binding": the call arrives here
// as a Runtime.bindingCalled event over our existing DevTools connection (no network port).
// We answer by calling window.__doubaoMods.onTopic(result) in the page.
let classifier = null;
let pickTopicWith = null; // classifier.mjs's topic rule, shared with the DeepSeek Harness plugin
let classifierLoad = 0;
async function startClassifier() {
  const load = ++classifierLoad;
  try {
    // Imported lazily so a missing `npm install` only disables the AI, not the mods.
    const lib = await import('./classifier.mjs');
    const { createClassifier } = lib;
    pickTopicWith = lib.pickTopicWith;
    const { TOPICS, NO_TOPIC_EXAMPLES, EVERYDAY_EXAMPLES } = await loadTopics();
    for (const model of TOPIC_MODELS) {
      try {
        const t0 = Date.now();
        log(`Loading AI topic model (${model})...`);
        const c = await createClassifier({ model, topics: TOPICS, noTopicExamples: NO_TOPIC_EXAMPLES,
          everydayExamples: EVERYDAY_EXAMPLES || [], log });
        if (load !== classifierLoad) return; // a newer reload (topics.mjs edited) superseded this one
        classifier = c;
        log(`AI topic model ready in ${Date.now() - t0} ms.`);
        return;
      } catch (e) {
        log(`Model ${model} failed: ${e.message}`);
      }
    }
    throw new Error('no model could be loaded');
  } catch (e) {
    log(`AI topic model unavailable, avatar uses keywords instead: ${e.message}`);
  }
}

// The topic for a conversation: its questions (oldest first) and the topic showing now. Returns
// { outfit, score } (outfit null: no topic), or null while the model isn't ready. Used for the apps'
// pages (answerTopic: a page then falls back to its keywords itself). The rule itself is
// topic-rule.mjs's pickTopicWith (through classifier.mjs), the same in every app.
async function pickTopic(questions, current) {
  if (!classifier || !pickTopicWith) return null;
  return pickTopicWith(classifier, questions, current);
}
// Claude and Kimi (no page of their own to fall back in): the model's topic, or, only while the model
// isn't available, the keywords, as the avatar in every page does (topic-rule.mjs).
async function pickTopicOrKeywords(questions, current) {
  const r = await pickTopic(questions, current);
  if (r) return r;
  const { TOPICS } = await loadTopics();
  return { outfit: keywordTopicOf(TOPICS, questions)?.outfit ?? null, byKeywords: true };
}

async function answerTopic(s, params) {
  let req;
  try { req = JSON.parse(params.payload); } catch { return; }
  let resp = { id: req.id, ready: false };
  const current = typeof req.current === 'string' ? req.current : null; // topic showing now
  const t0 = performance.now();
  const r = await pickTopic(req.questions || [], current);
  if (r) {
    resp = { id: req.id, ready: true, ...r };
    // Question text is not logged; how long the model took is (this PC's speed).
    log(`topic -> ${resp.outfit ?? 'none'}${resp.score ? ` (${resp.score})` : ''} in ${Math.round(performance.now() - t0)} ms`);
  }
  await s.c.send('Runtime.evaluate', {
    expression: `window.__doubaoMods?.onTopic?.(${JSON.stringify(resp)})`,
    contextId: params.executionContextId,
  }).catch(() => {});
}

// A clip for the avatar: the page calls window.__doubaoMedia(json {id, name}); we answer with the
// file's bytes via window.__doubaoMods.onMedia({id, name, data: base64 | null}). Only plain .webm
// names inside mods/media/ are served.
async function answerMedia(s, params) {
  let req;
  try { req = JSON.parse(params.payload); } catch { return; }
  const name = String(req.name || '');
  let data = null;
  if (MEDIA_NAME.test(name)) {
    try { data = (await readFile(join(MEDIA_DIR, name))).toString('base64'); } catch {}
  }
  await s.c.send('Runtime.evaluate', {
    expression: `window.__doubaoMods?.onMedia?.(${JSON.stringify({ id: req.id, name, data })})`,
    contextId: params.executionContextId,
  }).catch(() => {});
}

const sessions = new Map(); // "app:targetId" -> { c, scriptId }

// ---- Pet mode (watch mode only; see pet-host.mjs) ----
// Each app has its own pet mode switch and its own pet window.
// Plus Claude and Kimi (the desktop apps): they refuse a DevTools port, so their pets are docked to
// their windows and fed by the window helper (petclaude-dock.cs, reading them like a screen reader),
// plus Claude Code hooks for Claude (claude-bridge.mjs, claude-hook.mjs; kimi-bridge.mjs for Kimi).
const pet = args.has('--watch') ? createPetHost({
  root: ROOT,
  apps: { ...APPS, claude: { name: 'Claude', docked: true }, kimi: { name: 'Kimi', docked: true } },
  log,
  // Turned on or off for one app: re-inject that app, so its in-app avatar hides or comes back.
  onModeChanged: appId => APPS[appId] && run({ onlyApp: appId }).catch(e => log(e.message)),
  // Setup progress or an error, shown by that app's in-app avatar.
  notifyPages: (appId, info) => {
    for (const [key, s] of sessions)
      if (key.startsWith(appId + ':'))
        s.c.send('Runtime.evaluate', { expression: `window.__doubaoMods?.onPetMode?.(${JSON.stringify(info)})` }).catch(() => {});
  },
}) : null;
const petInfo = appId => pet ? pet.pageInfo(appId) : { on: false, available: false };

// The pet window runs the avatar mod too (pet/build/payload.js, loaded by pet/index.html). Rewritten
// when the mods change; the pet reloads only if it actually changed. (`--pet-bundle` writes it once
// without watching: the DeepSeek Harness plugin does that before starting its own pet.)
let petPayload = '';
async function writePetPayload(mods) {
  const avatarOnly = { ...mods, css: '', js: mods.js.filter(m => m.name === '30-avatar.js') };
  // chatMod: Claude's in-chat avatar mod is installed here (marker file .claude-chat-mod), so the Claude
  // pet's menu can offer "In the chat, beside each reply".
  const payload = buildPayload(avatarOnly, true, 'pet', { on: true, available: true, chatMod: existsSync(join(ROOT, '.claude-chat-mod')) });
  if (payload === petPayload) return false;
  petPayload = payload;
  await mkdir(join(ROOT, 'pet', 'build'), { recursive: true });
  await writeFile(join(ROOT, 'pet', 'build', 'payload.js'), payload);
  return true;
}

async function injectInto(key, t, payload) {
  let s = sessions.get(key);
  if (!s) {
    const c = await connect(t.webSocketDebuggerUrl);
    c.onClose(() => sessions.delete(key)); // window closed: forget it so a new one gets picked up
    await c.send('Page.enable');
    s = { c, scriptId: null };
    sessions.set(key, s);
    if (args.has('--watch')) {
      c.on(msg => {
        if (msg.method !== 'Runtime.bindingCalled') return;
        if (msg.params.name === '__doubaoTopic') answerTopic(s, msg.params);
        if (msg.params.name === '__doubaoMedia') answerMedia(s, msg.params);
        if (msg.params.name === '__doubaoPet') pet?.fromPage(key.split(':')[0], msg.params.payload);
      });
      await c.send('Runtime.enable');
      await c.send('Runtime.addBinding', { name: '__doubaoTopic' }); // survives page reloads
      await c.send('Runtime.addBinding', { name: '__doubaoMedia' });
      await c.send('Runtime.addBinding', { name: '__doubaoPet' });
      // With Runtime on (it carries the page's calls to those bindings), DevTools also keeps every console
      // message the app logs, and the objects in it, for as long as we're connected: let them go now and
      // then, so a long session doesn't slowly grow the app's memory.
      const consoleTimer = setInterval(() => {
        c.send('Runtime.discardConsoleEntries').catch(() => {});
        c.send('Runtime.releaseObjectGroup', { objectGroup: 'console' }).catch(() => {});
      }, 60000);
      consoleTimer.unref();
      c.onClose(() => clearInterval(consoleTimer));
    }
  }
  if (args.has('--watch')) {
    // Re-run automatically if the page reloads (only while this process stays connected).
    if (s.scriptId) await s.c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: s.scriptId });
    s.scriptId = (await s.c.send('Page.addScriptToEvaluateOnNewDocument', { source: payload })).identifier;
  }
  const result = await s.c.eval(payload);
  console.log(`[${new Date().toLocaleTimeString()}] ${t.url} -> ${result}`);
}

// onlyNew: inject just into windows we haven't seen yet (used by the background poll).
// onlyApp: re-inject just that app (its pet mode was switched).
// Returns how many app windows were found; throws if none of the apps is reachable.
async function run({ onlyNew = false, onlyApp = null } = {}) {
  const off = args.has('--off');
  const mods = off ? { css: '', js: [] } : await loadMods();
  if (pet && !off && !onlyNew && !onlyApp) {
    const changed = await writePetPayload(mods).catch(e => { log(`Pet page not written: ${e.message}`); return false; });
    if (changed) pet.modsChanged();
  }
  let found = 0;
  const present = new Set();
  for (const appId of onlyApp ? [onlyApp] : APP_IDS) {
    const app = APPS[appId];
    let targets;
    try { targets = (await listTargets(app.port)).filter(app.isTarget); } catch { continue; } // app not running
    found += targets.length;
    if (targets.length) present.add(appId);
    const fresh = targets.filter(t => !onlyNew || !sessions.has(`${appId}:${t.id}`));
    if (!fresh.length) continue;
    const payload = buildPayload(mods, !off, appId, petInfo(appId));
    for (const t of fresh) await injectInto(`${appId}:${t.id}`, t, payload);
  }
  // A pet shows only while its app is open (this runs every 2 s in watch mode).
  if (!onlyApp) pet?.setPresent(present);
  if (!found) throw new Error(`No ${APP_IDS.map(a => APPS[a].name).join(' or ')} window found. Start it with its "Start ... with Avatar" file, or from the tray, first.`);
  return found;
}

// Only one watcher at a time, from any copy of this folder (the Start files may be double-clicked
// repeatedly, and Claude Code's hooks can start one at the same moment): it holds launch.mjs's
// WATCHER_LOCK pipe, which only one process can create. The pid file is for the tray (stopping it).
const PID_FILE = join(dirname(fileURLToPath(import.meta.url)), '.watcher.pid');
function takeWatcherLock(tries = 3) {
  return new Promise(resolve => {
    const lock = createServer(sock => sock.destroy());   // only held, never talked to
    lock.once('error', () => {
      // Held: by a watcher, or for an instant by a check (launch.mjs watcherRunning), so try again.
      if (tries > 1) setTimeout(() => takeWatcherLock(tries - 1).then(resolve), 250);
      else resolve(false);
    });
    lock.listen(WATCHER_LOCK, () => { lock.unref(); resolve(true); });
  });
}

// --pet-bundle: write pet/build/payload.js (the pet window's copy of the avatar mod) and exit.
if (args.has('--pet-bundle')) {
  await writePetPayload(await loadMods());
  console.log('pet bundle written');
  process.exit(0);
}

// --bundle <file>: write the injection script to a file instead (for testing mods in a mock page).
const bundleAt = process.argv.indexOf('--bundle');
if (bundleAt > 0) {
  await writeFile(process.argv[bundleAt + 1], buildPayload(await loadMods(), true, appArg || 'doubao'));
  console.log('bundle written');
  process.exit(0);
}

if (args.has('--watch')) await prepareLock();   // macOS: clear a lock file left by a crashed watcher
if (args.has('--watch') && !await takeWatcherLock()) {
  console.log('A mods watcher is already running.');
  process.exit(0);
}

// A watcher may start before its app's window is ready, so only one-off runs fail straight away.
if (args.has('--watch')) {
  // Claim the pid file straight away: a second watcher (or the tray, pet/tray.js, deciding whether
  // the watcher crashed) must see this one while its first injection is still running.
  await writeFile(PID_FILE, String(process.pid));
  process.on('exit', () => { try { if (readFileSync(PID_FILE, 'utf8') === String(process.pid)) unlinkSync(PID_FILE); } catch {} });
  await pet.load();
  createClaudeBridge({ host: pet, pickTopic: pickTopicOrKeywords, log });
  createKimiBridge({ host: pet, pickTopic: pickTopicOrKeywords, log });
  await run().catch(e => log(e.message)); // also brings back pets that were on last time
  process.on('exit', () => pet.stop());
} else await run();

if (args.has('--watch')) {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));

  console.log(`Watching ${MODS_DIR} - save a mod file to hot-reload. Ctrl+C to stop.`);
  let timer;
  const reinject = () => {
    clearTimeout(timer);
    timer = setTimeout(() => run().catch(e => console.error(e.message)), 150);
  };
  // Only react to real edits. On Windows the watcher also fires when a file is merely read and
  // Windows updates its "last accessed" time (about once an hour per file), e.g. when a walk clip
  // is served to the page. That used to reload the avatar mid-walk, back to the everyday look.
  const seen = new Map(); // path -> "size:mtime" last time we looked
  const signature = path => { try { const s = statSync(path); return `${s.size}:${s.mtimeMs}`; } catch { return 'gone'; } };
  const changed = path => {
    const now = signature(path), before = seen.get(path);
    seen.set(path, now);
    return now !== before;
  };
  const prime = async dir => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => []))
      e.isDirectory() ? await prime(join(dir, e.name)) : seen.set(join(dir, e.name), signature(join(dir, e.name)));
  };
  await prime(MODS_DIR);
  seen.set(TOPICS_FILE, signature(TOPICS_FILE));
  watch(MODS_DIR, { recursive: true }, (event, name) => { if (!name || changed(join(MODS_DIR, name))) reinject(); });

  // The language chosen in the tray (lang.mjs): when it changes, the avatar everywhere is re-applied in
  // it. Checked once a second (the file is tiny; its folder may not exist yet).
  let lang = readLang();
  watchFile(LANG_FILE, { interval: 1000 }, () => {
    if (readLang() === lang) return;
    lang = readLang();
    log(`language: ${lang}`);
    reinject();
  });

  // The model loads in the background; until it's ready the avatar uses keywords.
  startClassifier();
  let topicsTimer;
  watch(TOPICS_FILE, () => {
    if (!changed(TOPICS_FILE)) return;
    reinject();
    clearTimeout(topicsTimer);
    topicsTimer = setTimeout(startClassifier, 300); // re-learn the edited examples
  });

  // Pick up new windows (and apps started later), and quit once every app has been closed for
  // ~10 seconds. Allow ~40 s at startup for an app that is still launching.
  // The tray icon (pet/tray.js) asks the watcher to stop by creating .watcher.stop.
  const STOP_FILE = join(ROOT, '.watcher.stop');
  try { unlinkSync(STOP_FILE); } catch {} // left over from a watcher that had already gone
  let misses = -15;
  // Claude and Kimi (no DevTools port) keep it running while their pet is on and the app runs, even
  // with its window hidden or closed to the tray (Kimi's X only hides it): otherwise she was gone for
  // good once the window came back. Their process list is read at most every 15 s.
  let dockedCheck = { at: 0, running: false };
  async function dockedStillRunning() {
    const ids = pet?.dockedOn?.() || [];
    if (!ids.length) return false;
    if (Date.now() - dockedCheck.at > 15000) {
      const { dockedAppRunning } = await import('./launch.mjs');
      dockedCheck = { at: Date.now(), running: (await Promise.all(ids.map(dockedAppRunning))).some(Boolean) };
    }
    return dockedCheck.running;
  }
  let polling = false;
  setInterval(async () => {
    try { unlinkSync(STOP_FILE); log('Asked to stop - watcher exiting.'); process.exit(0); } catch {}
    if (polling) return;
    polling = true;
    try {
      await run({ onlyNew: true });
      misses = 0;
    } catch (e) {
      if (++misses >= 5 && !pet?.dockedOpen() && !await dockedStillRunning()) { log('No app is open - watcher exiting.'); process.exit(0); }
    } finally { polling = false; }
  }, 2000);

  // Chat box check. If an app is open but none of its windows has shown its chat box (APP.composer)
  // during 3 minutes that a window was visible, its page was most likely redesigned in an update
  // and the avatar has nowhere to stand. Told once per app while it stays open: logged, and written
  // to .no-chatbox, which the tray reads and shows in a box (launch.mjs noChatBoxNotice).
  const NO_CHATBOX_FILE = join(ROOT, '.no-chatbox');
  try { unlinkSync(NO_CHATBOX_FILE); } catch {}
  const CHATBOX_GRACE_MS = Number(process.env.AVATAR_CHATBOX_GRACE_S || 180) * 1000;
  const CHATBOX_STEP_MS = 5000;
  const chatbox = new Map(); // app id -> { found, visibleMs, told }; forgotten when the app closes
  let checking = false;
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const open = new Set([...sessions.keys()].map(k => k.split(':')[0]));
      for (const id of chatbox.keys()) if (!open.has(id)) chatbox.delete(id);
      for (const id of open) {
        const composer = APPS[id]?.page?.composer;
        if (!composer) continue;
        let st = chatbox.get(id);
        if (!st) chatbox.set(id, st = { found: false, visibleMs: 0, told: false });
        if (st.found || st.told) continue;
        let visible = false;
        for (const [key, s] of sessions) {
          if (!key.startsWith(`${id}:`)) continue;
          const r = await s.c.eval(`document.querySelector(${JSON.stringify(composer)}) ? 'found' : document.visibilityState`).catch(() => null);
          if (r === 'found') { st.found = true; break; }
          if (r === 'visible') visible = true;
        }
        if (st.found || !visible) continue;
        st.visibleMs += CHATBOX_STEP_MS;
        if (st.visibleMs >= CHATBOX_GRACE_MS) {
          st.told = true;
          log(`${APPS[id].name}: no chat box found while its window was visible for ${CHATBOX_GRACE_MS / 1000} s - its page may have changed in an update.`);
          try { appendFileSync(NO_CHATBOX_FILE, `${id}\n`); } catch {}
        }
      }
    } finally { checking = false; }
  }, CHATBOX_STEP_MS);
} else {
  for (const { c } of sessions.values()) c.close();
}
