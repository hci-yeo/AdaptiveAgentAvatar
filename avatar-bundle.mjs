// The avatar's page code, put together the same way wherever she appears:
//   - the desktop apps and the desktop pet window (watcher.mjs, sent over DevTools)
//   - the DeepSeek Harness plugin (integrations/deepseek-harness/build.mjs -> client.js)
//   - the browser extension (browser-extension/build.mjs -> content script)
// Each of those adds only its own way of talking to the page (its "glue": how a topic or a clip is
// asked for), and its own page description (APP: apps.mjs for the desktop apps).
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Walk clips are too big to put in the page; it asks for them one at a time, by these names only.
export const MEDIA_NAME = /^[a-z0-9_-]+\.webm$/i;
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

// Everything in mods/ the page needs: css, js (one entry per mod file), assets (pictures as data URLs,
// since some apps' pages can't load files), topics (each topic's expert, look and keywords; not the
// model's examples), media (clip names), trims (where each clip's empty stretch starts and ends), and
// rule (topic-rule.mjs, for the keyword fallback). Topics are re-read every time (edits apply at once).
export async function loadMods(root = ROOT) {
  const modsDir = join(root, 'mods'), mediaDir = join(modsDir, 'media');
  const files = (await readdir(modsDir)).filter(f => !f.startsWith('_')).sort();
  const css = [], js = [];
  for (const f of files) {
    if (!f.endsWith('.css') && !f.endsWith('.js')) continue;
    const src = await readFile(join(modsDir, f), 'utf8');
    if (f.endsWith('.css')) css.push(`/* ${f} */\n${src}`);
    else js.push({ name: f, src });
  }
  const assets = {};
  for (const f of (await readdir(join(modsDir, 'assets')).catch(() => [])).sort()) {
    const type = MIME[f.slice(f.lastIndexOf('.')).toLowerCase()];
    if (type) assets[f] = `data:${type};base64,${(await readFile(join(modsDir, 'assets', f))).toString('base64')}`;
  }
  const { TOPICS } = await import(pathToFileURL(join(root, 'topics.mjs')).href + '?v=' + Date.now());
  const topics = TOPICS.map(({ outfit, expert, emoji, label, labelZh, zh, en }) => ({ outfit, expert: expert || outfit, emoji, label, labelZh, zh, en }));
  const media = (await readdir(mediaDir).catch(() => [])).filter(f => MEDIA_NAME.test(f)).sort();
  let trims = {};
  try { trims = JSON.parse(await readFile(join(mediaDir, 'trims.json'), 'utf8')); } catch {}
  const rule = await readFile(join(root, 'topic-rule.mjs'), 'utf8');
  return { css: css.join('\n'), js, assets, topics, media, trims, rule };
}

// The start of every run of the avatar in a page. Only the page's own main window (not a frame inside
// it). Undoes the previous run (each mod returns a cleanup function), starts a new generation (a mod
// that sees M.generation move on stops itself, in case a crash kept its cleanup from being
// registered), and sweeps up anything left behind (every mod element has a doubao-mods- id).
// Runs inside a function: the main-window check returns from it.
export const PRELUDE = `
  if (window !== window.top) return 'skipped (inside a frame)';
  const M = window.__doubaoMods || (window.__doubaoMods = { cleanups: [] });
  for (const fn of M.cleanups.splice(0)) { try { fn(); } catch (e) {} }
  M.generation = (M.generation || 0) + 1;
  const GEN = M.generation;
  for (const el of document.querySelectorAll('[id^="doubao-mods-"]')) el.remove();
`;

// The data every mod can use: ASSETS, TOPICS, MEDIA, CLIP_TRIMS, APP, PET, TOPIC_RULE (topic-rule.mjs:
// keywordTopic(topics, text), keywordTopicOf(topics, questions), isCommand(text), the limits) and LANG
// ('en' | 'zh': the language her menus and tags use).
// lang: the desktop passes the tray's choice (lang.mjs); without one (the browser extension, DeepSeek
// Harness, Android) the page's own display language decides. In Chinese, TOPICS' labels are Chinese.
export function constants(mods, app, pet, lang) {
  const rule = mods.rule.replace(/^export /gm, '');
  return `
  const LANG = ${JSON.stringify(lang === 'zh' || lang === 'en' ? lang : null)}
    || (String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const ASSETS = ${JSON.stringify(mods.assets)};
  const TOPICS = ${JSON.stringify(mods.topics)};
  if (LANG === 'zh') for (const t of TOPICS) if (t.labelZh) t.label = t.labelZh;
  const MEDIA = ${JSON.stringify(mods.media)};
  const CLIP_TRIMS = ${JSON.stringify(mods.trims)};
  const APP = ${JSON.stringify(app)};
  const PET = ${JSON.stringify(pet)};
  const TOPIC_RULE = (() => {
    ${rule}
    return { keywordTopic, keywordTopicOf, isCommand, MAX_QUESTIONS, MAX_CHARS };
  })();
`;
}

// The page's stylesheet (mods/*.css) and each JS mod, each in its own function: one failing leaves the
// others running; a mod's returned cleanup runs before the next run.
export function applyBlock(mods, tag = 'avatar') {
  const blocks = mods.js.map(({ name, src }) => `
    try {
      const cleanup = (function () { ${src}\n })();
      if (typeof cleanup === 'function') M.cleanups.push(cleanup);
    } catch (e) { console.error('[${tag}] ${name} failed:', e); }`).join('\n');
  return `
    const style = document.createElement('style');
    style.id = 'doubao-mods-style';
    style.textContent = ${JSON.stringify(mods.css)};
    document.head.appendChild(style);
    ${blocks}
`;
}
