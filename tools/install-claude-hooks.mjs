// Adds (or removes) the Claude pet's hooks in your Claude Code user settings
// (%USERPROFILE%\.claude\settings.json), so every Claude Code session tells the pet what it's doing.
// Keeps a copy of the settings as settings.json.before-avatar-hooks the first time.
//
//   node tools\install-claude-hooks.mjs            add the hooks
//   node tools\install-claude-hooks.mjs --remove   take them out again
//   node tools\install-claude-hooks.mjs --move-here   Install.bat: point hooks here only if they were
//                                        added from a copy of the avatar that's gone (the folder was
//                                        moved); quietly does nothing otherwise
//
// New Claude Code sessions pick the hooks up; sessions that are already open may need a restart.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(homedir(), '.claude', 'settings.json');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
const slash = p => p.replace(/\\/g, '/');
const command = `"${slash(process.execPath)}" "${slash(join(ROOT, 'claude-hook.mjs'))}"`;
const ours = h => typeof h?.command === 'string' && h.command.includes('claude-hook.mjs');

const moveHere = process.argv.includes('--move-here');
let settings;
try { settings = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; }
catch (e) { if (moveHere) process.exit(0); throw e; }

if (moveHere) {
  // Only hooks someone added before, all running a claude-hook.mjs that no longer exists. Hooks from
  // this folder, or from another copy of the avatar that's still there, are left as they are.
  const scripts = EVENTS.flatMap(ev => settings.hooks?.[ev] || []).flatMap(g => g.hooks || []).filter(ours)
    .map(h => (h.command.match(/"([^"]*claude-hook\.mjs)"/) || [])[1]);
  if (!scripts.length || scripts.some(s => !s || existsSync(s))) process.exit(0);
  console.log('This folder was moved: pointing the Claude Code hooks here.');
}

if (existsSync(FILE) && !existsSync(FILE + '.before-avatar-hooks')) copyFileSync(FILE, FILE + '.before-avatar-hooks');
settings.hooks ||= {};
for (const ev of EVENTS) {
  // Drop any earlier copy of ours (an old path), keep everyone else's.
  const groups = (settings.hooks[ev] || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) }))
    .filter(g => g.hooks.length);
  if (!process.argv.includes('--remove')) {
    const hook = { type: 'command', command, timeout: 10 };
    groups.push(ev === 'PreToolUse' ? { matcher: '*', hooks: [hook] } : { hooks: [hook] });
  }
  if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;
writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log(process.argv.includes('--remove')
  ? 'Claude pet hooks removed.'
  : `Claude pet hooks added to ${FILE}.\nNew Claude Code sessions will drive the pet; restart sessions that are already open.`);
