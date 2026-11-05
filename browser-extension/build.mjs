// Builds the browser extension (Chrome, Edge and other Chromium browsers) from the same avatar the
// desktop apps use: mods/*.js, mods/assets, mods/media, topics.mjs and the bundled topic model.
//   node browser-extension/build.mjs
// Output: browser-extension/build/chrome/ (load it unpacked) and browser-extension/build/ai-avatar-chrome.zip
// (for the Chrome Web Store / Edge Add-ons). Edit mods/ and browser-extension/src/, never the output.
import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SITES } from './src/sites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(HERE, 'src');
const OUT = join(HERE, 'build', 'chrome');
const VENDOR = join(HERE, 'vendor');
const MODS = join(ROOT, 'mods');
const MEDIA = join(MODS, 'media');
// classifier.mjs 'gemma-300m-web': EmbeddingGemma 300M, 4-bit, vocabulary cut to Chinese + English
// (see ../README.md, "Why EmbeddingGemma"). model_web_q4.onnx is written by tools/trim-gemma.py: the
// word lookup uses plain operations the browser's engine has (the published browser variant multiplies
// a 262,144-wide one-hot vector per token instead, which was slow and took ~1.4 GB).
// Gemma Terms of Use apply: NOTICE.txt and GEMMA_TERMS.txt ship with the model files.
const MODEL_ID = 'local/embeddinggemma-300m-zh-en';
const MODEL_PREFIX = 'task: classification | query: ';
const MODEL_DTYPE = 'q4';
const MODEL_FILE_NAME = 'model_web';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
  'onnx/model_web_q4.onnx', 'onnx/model_web_q4.onnx_data', 'NOTICE.txt'];
const OPTIONAL_MODEL_FILES = ['GEMMA_TERMS.txt'];
// The AI engine's WebAssembly file, which transformers.js would otherwise download from a CDN
// (extensions may not load code from the internet). Must match the version transformers.js expects.
const ORT_VERSION = JSON.parse(await readFile(join(ROOT, 'node_modules/@huggingface/transformers/package.json'), 'utf8')).dependencies['onnxruntime-web'];
// transformers.js asks for the "asyncify" variant in Chromium (checked in Edge 156; the jsep one is not used).
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
const VERSION = '0.1.0';
const log = s => console.log(`[build] ${s}`);
const exists = p => stat(p).then(() => true, () => false);

// ---- What the avatar gets: built exactly as for the desktop apps and DeepSeek Harness -------------
// (avatar-bundle.mjs: pictures, topics, clip names, the topic rule, the start of each run, each mod in
// its own function). Only the glue (glue.js: how a topic or a clip is asked for) is the extension's own.
const bundle = await import(pathToFileURL(join(ROOT, 'avatar-bundle.mjs')).href);
const loaded = await bundle.loadMods(ROOT);
const { assets, media } = loaded;
const { TOPICS, NO_TOPIC_EXAMPLES, EVERYDAY_EXAMPLES = [] } = await import(pathToFileURL(join(ROOT, 'topics.mjs')).href);   // examples, for the bank
const { EVERYDAY } = await import(pathToFileURL(join(ROOT, 'topic-rule.mjs')).href);   // the everyday examples' label
const glue = await readFile(join(SRC, 'glue.js'), 'utf8');
const addedSites = await readFile(join(SRC, 'added-sites.js'), 'utf8');

// A site the user added from the toolbar button: no hand-picked markers. added-sites.js finds the chat
// box and the stop button by itself and marks them, and supplies your questions as you send them.
const ADDED_PAGE = {
  added: true,
  pane: null,
  composer: '[data-avatar-composer]',
  natural: 'self',
  // Never move the chat box: an unknown site often centres it with automatic margins, which a
  // margin of ours would break. Without room beside it, she stands just above its left end.
  shift: 'none',
  userMessages: null,
  answering: '[data-avatar-stop]',
  answers: '[data-avatar-answer]',
};

// One content script for every site (the pictures are inside it, ~5.6 MB, so one copy rather than one
// per site). It picks the site's page settings by the address it runs on; the site ids stay
// `web-<site>`, so the avatar's settings, saved per site, are the same as with one script per site.
// On any other address it's a site the user added (web-<its host>).
function contentScript() {
  const hosts = {};   // host -> site id, from each site's match patterns (https://host/*)
  for (const [id, s] of Object.entries(SITES)) for (const m of s.matches) hosts[new URL(m.replace('/*', '/')).hostname] = id;
  const pages = Object.fromEntries(Object.entries(SITES).map(([id, s]) => [id, { id: `web-${id}`, ...s.page }]));
  // constants() writes APP as JSON: write a stand-in, then swap in the pick by address.
  const PLACEHOLDER = { __site__: true };
  const placeholder = `const APP = ${JSON.stringify(PLACEHOLDER)};`;
  const consts = bundle.constants(loaded, PLACEHOLDER, { on: false, available: false });
  if (!consts.includes(placeholder)) throw new Error('avatar-bundle.constants() no longer writes APP as expected');
  const pick = `const APP = ${JSON.stringify(pages)}[${JSON.stringify(hosts)}[location.hostname]]
    || { id: 'web-' + location.hostname, ...${JSON.stringify(ADDED_PAGE)} };`;
  return `// Generated by browser-extension/build.mjs from mods/ - edit those, not this file.
(() => {${bundle.PRELUDE}${consts.replace(placeholder, () => pick)}
  ${glue}
  ${addedSites}
  const apply = () => {${bundle.applyBlock(loaded, 'ai-avatar')}};
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', apply, { once: true }) : apply();
})();
`;
}

// ---- The topic model's example vectors, computed once here instead of in every browser ---------
async function buildBank() {
  // Labels: the topic, null for a follow-up, EVERYDAY for small talk (classifier.mjs builds the same bank).
  const groups = [...TOPICS.map(t => ({ outfit: t.outfit, examples: t.examples })), { outfit: null, examples: NO_TOPIC_EXAMPLES },
    { outfit: EVERYDAY, examples: EVERYDAY_EXAMPLES }];
  const texts = [], labels = [];
  for (const g of groups) for (const ex of g.examples || []) { texts.push(ex); labels.push(g.outfit); }
  const key = createHash('sha256').update(JSON.stringify({ MODEL_ID, MODEL_PREFIX, MODEL_DTYPE, MODEL_FILE_NAME, texts, labels })).digest('hex').slice(0, 16);
  const cacheJson = join(VENDOR, 'bank.json'), cacheBin = join(VENDOR, 'bank.bin');
  if (await exists(cacheJson)) {
    const old = JSON.parse(await readFile(cacheJson, 'utf8'));
    if (old.key === key) { log(`example vectors unchanged (${labels.length} examples)`); return; }
  }
  log(`computing vectors for ${labels.length} example questions...`);
  const { AutoTokenizer, AutoModel, env } = await import('@huggingface/transformers');
  env.localModelPath = join(ROOT, 'models');
  env.allowRemoteModels = false;
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: MODEL_DTYPE, model_file_name: MODEL_FILE_NAME });
  const vecs = [];
  for (let i = 0; i < texts.length; i += 16) {
    const inputs = await tokenizer(texts.slice(i, i + 16).map(t => MODEL_PREFIX + t), { padding: true, truncation: true });
    vecs.push(...(await model(inputs)).sentence_embedding.normalize(2, -1).tolist());
  }
  const dim = vecs[0].length;
  const flat = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  await mkdir(VENDOR, { recursive: true });
  await writeFile(cacheBin, Buffer.from(flat.buffer));
  await writeFile(cacheJson, JSON.stringify({ key, model: MODEL_ID, prefix: MODEL_PREFIX, dtype: MODEL_DTYPE, fileName: MODEL_FILE_NAME, dim, labels }));
}

// ---- The AI engine's WebAssembly, fetched once into vendor/ --------------------------------------
async function ensureOrt() {
  if ((await Promise.all(ORT_FILES.map(f => exists(join(VENDOR, f))))).every(Boolean)) return;
  log(`downloading onnxruntime-web@${ORT_VERSION} (once)...`);
  const tmp = join(tmpdir(), `ai-avatar-ort-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  execFileSync('npm', ['pack', `onnxruntime-web@${ORT_VERSION}`, '--silent'], { cwd: tmp, shell: true });
  const tgz = (await readdir(tmp)).find(f => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: tmp });
  await mkdir(VENDOR, { recursive: true });
  for (const f of ORT_FILES) await cp(join(tmp, 'package', 'dist', f), join(VENDOR, f));
  await rm(tmp, { recursive: true, force: true });
}

// ---- Assemble -------------------------------------------------------------------------------------
await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'lib'), { recursive: true });
await buildBank();
await ensureOrt();

for (const f of ['background.js', 'offscreen.html', 'offscreen.js', 'welcome.html', 'popup.html', 'popup.js']) await cp(join(SRC, f), join(OUT, f));
// The topic rule the model page uses: the same file as every app's (topic-rule.mjs).
await cp(join(ROOT, 'topic-rule.mjs'), join(OUT, 'topic-rule.mjs'));
await cp(join(VENDOR, 'bank.json'), join(OUT, 'bank.json'));
await cp(join(VENDOR, 'bank.bin'), join(OUT, 'bank.bin'));
await cp(join(ROOT, 'node_modules/@huggingface/transformers/dist/transformers.min.js'), join(OUT, 'lib', 'transformers.min.js'));
// Their licenses travel with them (Transformers.js: Apache 2.0; ONNX Runtime: MIT, its npm packages
// carry no license file, so the project keeps a copy in licenses/).
await cp(join(ROOT, 'node_modules/@huggingface/transformers/LICENSE'), join(OUT, 'lib', 'LICENSE-transformers.js.txt'));
await cp(join(ROOT, 'licenses/onnxruntime-LICENSE.txt'), join(OUT, 'lib', 'LICENSE-onnxruntime.txt'));
// The project's own licenses: MIT for the code, CC BY-NC 4.0 for the artwork.
for (const f of ['LICENSE', 'LICENSE-ART']) await cp(join(ROOT, f), join(OUT, f + '.txt'));
for (const f of ORT_FILES) await cp(join(VENDOR, f), join(OUT, 'lib', f));
for (const f of [...MODEL_FILES, ...OPTIONAL_MODEL_FILES]) {
  if (OPTIONAL_MODEL_FILES.includes(f) && !(await exists(join(ROOT, 'models', MODEL_ID, f)))) continue;
  await mkdir(dirname(join(OUT, 'models', MODEL_ID, f)), { recursive: true });
  await cp(join(ROOT, 'models', MODEL_ID, f), join(OUT, 'models', MODEL_ID, f));
}
await mkdir(join(OUT, 'media'), { recursive: true });
for (const f of media) await cp(join(MEDIA, f), join(OUT, 'media', f));

await writeFile(join(OUT, 'content.js'), contentScript());

// Icons: the everyday expert's face.
const sharp = (await import('sharp')).default;
const face = join(MODS, 'assets', 'expert-casual.webp');
await mkdir(join(OUT, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const meta = await sharp(face).metadata();
  // A square from her top as wide as her middle part (550 of the 768 px height), so the wider
  // pictures (Nov 2026) are framed like the old 550 px ones instead of zoomed out.
  const side = Math.min(meta.width, Math.round(meta.height * 550 / 768));
  await sharp(face).extract({ left: Math.round((meta.width - side) / 2), top: 0, width: side, height: side })
    .resize(size, size).png().toFile(join(OUT, 'icons', `icon${size}.png`));
}

const allMatches = Object.values(SITES).flatMap(s => s.matches);
const manifest = {
  manifest_version: 3,
  name: 'Adaptive Agent Avatar',
  short_name: 'AI Avatar',
  version: VERSION,
  // At most 132 characters (store listing limit).
  description: 'An avatar that matches the topic of your AI chat and reacts as it answers. ChatGPT, Claude, Doubao, Kimi, Qwen, or any site you add.',
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  background: { service_worker: 'background.js' },
  // The toolbar button: add her to the site in the current tab (popup.js).
  action: { default_popup: 'popup.html', default_title: 'Adaptive Agent Avatar', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
  // offscreen: the model page. storage: added sites, picked chat boxes, questions sent there.
  // scripting: run her on added sites. activeTab: the popup reads the current tab's address.
  permissions: ['offscreen', 'storage', 'scripting', 'activeTab'],
  content_scripts: [{ matches: allMatches, js: ['content.js'], run_at: 'document_idle' }],
  // Any other site only once the user adds it from the toolbar button (Chrome asks them, per site).
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  // The clips are fetched by the content script, so every site she may run on (added ones included)
  // can load them; dynamic URLs stop pages from detecting the extension through them.
  web_accessible_resources: [{ resources: ['media/*'], matches: ['https://*/*', 'http://*/*'], use_dynamic_url: true }],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  // Cross-origin isolation for the extension's own pages (not the sites it runs on): it lets the
  // model page use SharedArrayBuffer, so the AI engine can run on several CPU threads.
  cross_origin_embedder_policy: { value: 'require-corp' },
  cross_origin_opener_policy: { value: 'same-origin' },
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// A zip for the stores.
const AdmZip = (await import('adm-zip')).default;
const zip = new AdmZip();
zip.addLocalFolder(OUT);
const zipPath = join(HERE, 'build', 'ai-avatar-chrome.zip');
zip.writeZip(zipPath);

let total = 0;
const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(join(d, e.name)) : (total += (await stat(join(d, e.name))).size); };
await walk(OUT);
log(`done: ${OUT} (${(total / 1e6).toFixed(0)} MB, ${media.length} clips, ${Object.keys(assets).length} pictures), zip ${((await stat(zipPath)).size / 1e6).toFixed(0)} MB`);
