// The avatar in DeepSeek Harness (DSH): a plugin added with DSH's own command,
//   dsh plugin --profile desktop add link:<this folder>\integrations\deepseek-harness
// "link:" means DSH runs the plugin straight from this folder (it shares this folder's clips, AI model
// and pet program), so after moving the folder it has to be added again; --start does that by itself.
//
//   node tools\dsh-plugin.mjs --start    add the plugin if needed, then open DeepSeek Harness
//                                        ("scripts\Start DeepSeek Harness with Avatar.bat")
//   node tools\dsh-plugin.mjs            add the plugin (again)
//   node tools\dsh-plugin.mjs --remove   take it out ("scripts\Remove DeepSeek Harness plugin.bat")
//   node tools\dsh-plugin.mjs --remove-if-here   Uninstall.bat: take it out only if it runs from this
//                                        folder; quietly does nothing otherwise (or without DSH)
//   node tools\dsh-plugin.mjs --move-here        Install.bat: add it again from here only if it was
//                                        added from a copy of the avatar that's gone (the folder was
//                                        moved); quietly does nothing otherwise (or without DSH)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'integrations', 'deepseek-harness');
const NAME = '@local/ai-avatar';
const PROFILE = process.env.AVATAR_DSH_PROFILE || 'desktop';   // the profile the DeepSeek Harness desktop app uses
const PROFILE_FILE = join(homedir(), '.dsh', 'profiles', PROFILE, 'package.json');
const APP_DIR = join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
const APP = join(APP_DIR, 'DeepSeek Harness.exe');
const DSH = join(APP_DIR, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
const LINK = `link:${PLUGIN.replace(/\\/g, '/')}`;
const args = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Whether the plugin is already added, from this folder, and switched on.
function installedHere() {
  try {
    const p = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    return p.dependencies?.[NAME] === LINK && (p.dsh?.profile?.bundles || []).includes(NAME);
  } catch { return false; }
}

// DSH's plugin command (a .cmd file, so it runs through cmd.exe; paths quoted for folders with spaces).
function dshPlugin(verb, target) {
  const r = spawnSync(`"${DSH}" plugin --profile ${PROFILE} ${verb} "${target}"`, { shell: true, stdio: 'inherit', windowsHide: true });
  return r.status === 0;
}

const running = () => /DeepSeek Harness\.exe/i.test(spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || '');
const openApp = () => spawn(APP, [], { detached: true, stdio: 'ignore', cwd: APP_DIR }).unref();

// Uninstall.bat: only a plugin that runs from this folder, and never an error.
if (args.includes('--remove-if-here')) {
  let linked = false;
  try { linked = JSON.parse(readFileSync(PROFILE_FILE, 'utf8')).dependencies?.[NAME] === LINK; } catch {}
  if (linked && existsSync(DSH)) {
    console.log(dshPlugin('remove', NAME) ? 'Removed the avatar plugin from DeepSeek Harness.' : 'Could not remove the DeepSeek Harness plugin.');
  }
  process.exit(0);
}

// Install.bat: a plugin added from a copy of the avatar that's no longer there (this folder before it
// was moved) would stop DSH from starting, so add it again from here. A plugin from this folder, or
// from another copy that's still there, is left as it is.
if (args.includes('--move-here')) {
  let linked = null;
  try { linked = JSON.parse(readFileSync(PROFILE_FILE, 'utf8')).dependencies?.[NAME] ?? null; } catch {}
  const linkedDir = linked?.startsWith('link:') ? linked.slice(5) : null;
  if (linkedDir && linked !== LINK && !existsSync(linkedDir) && existsSync(DSH) && existsSync(join(PLUGIN, 'client.js'))) {
    console.log('This folder was moved: adding the avatar to DeepSeek Harness again from here.');
    if (!dshPlugin('add', LINK)) console.log('Could not add it. Open DeepSeek Harness from her tray menu to try again.');
    else if (running()) console.log('Restart DeepSeek Harness to see her.');
  }
  process.exit(0);
}

if (!existsSync(DSH) || !existsSync(APP)) {
  console.log('DeepSeek Harness was not found on this PC (looked in %LOCALAPPDATA%\\Programs\\DeepSeek Harness).');
  process.exit(1);
}

if (args.includes('--remove')) {
  // Only this folder's plugin, or one whose folder is gone (it only breaks DSH then). A copy of the
  // avatar elsewhere (another download, the folder it was moved to) keeps its plugin.
  let linked = null;
  try { linked = JSON.parse(readFileSync(PROFILE_FILE, 'utf8')).dependencies?.[NAME] ?? null; } catch {}
  const linkedDir = linked?.startsWith('link:') ? linked.slice(5) : null;
  if (!linked) { console.log('The avatar plugin is not in DeepSeek Harness.'); process.exit(0); }
  if (linked !== LINK && linkedDir && existsSync(linkedDir)) {
    console.log(`The avatar plugin in DeepSeek Harness runs from another copy of the avatar:\n  ${linkedDir.replace(/\//g, '\\')}\nNothing was removed. To remove it, run this file from that copy.`);
    process.exit(1);
  }
  if (!dshPlugin('remove', NAME)) { console.log('\nDeepSeek Harness could not remove the plugin (see above).'); process.exit(1); }
  console.log('\nThe avatar plugin is removed from DeepSeek Harness. Restart DeepSeek Harness.');
  process.exit(0);
}

const start = args.includes('--start');

// A fresh install of DSH has no profile until it has run once: open it so it sets itself up.
if (!existsSync(PROFILE_FILE)) {
  if (!start) { console.log('Open DeepSeek Harness once (so it sets itself up), close it, then run this again.'); process.exit(1); }
  console.log('Opening DeepSeek Harness for the first time, so it can set itself up...');
  if (!running()) openApp();
  for (let i = 0; i < 90 && !existsSync(PROFILE_FILE); i++) await sleep(1000);
  if (!existsSync(PROFILE_FILE)) { console.log('DeepSeek Harness did not finish setting up. Close it, then run this again.'); process.exit(1); }
}

if (!existsSync(join(ROOT, 'models', 'local', 'embeddinggemma-300m-zh-en'))) {
  console.log('Note: the AI topic model is missing (models folder), so she will pick topics with keyword lists.');
}

// The plugin's page code (client.js) is built from mods/ and isn't kept in git: a fresh clone builds it
// here once (the release download already has it).
if (!existsSync(join(PLUGIN, 'client.js'))) {
  console.log('Building the avatar for DeepSeek Harness (once)...');
  const b = spawnSync(process.execPath, ['build.mjs'], { cwd: PLUGIN, stdio: 'inherit', windowsHide: true });
  if (b.status !== 0) { console.log('\nCould not build it (see above).'); process.exit(1); }
}

let added = false;
if (!start || !installedHere()) {
  console.log('Adding the avatar to DeepSeek Harness...');
  if (!dshPlugin('add', LINK)) { console.log('\nDeepSeek Harness could not add the plugin (see above).'); process.exit(1); }
  added = true;
}

if (!start) {
  console.log('\nThe avatar plugin is added to DeepSeek Harness. Restart DeepSeek Harness to see her.');
} else if (!running()) {
  openApp();
  console.log('Opening DeepSeek Harness with the avatar.');
} else if (added) {
  console.log('\nDeepSeek Harness is already open: close it and open it again (or run this file again after closing it) to see her.');
  process.exit(2);
} else {
  console.log('DeepSeek Harness is already open with the avatar.');
}
