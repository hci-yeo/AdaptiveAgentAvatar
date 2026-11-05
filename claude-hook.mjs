// Claude Code hook for the Claude pet (the avatar docked to the Claude desktop app's window).
// Registered in %USERPROFILE%\.claude\settings.json for SessionStart, UserPromptSubmit, PreToolUse and
// Stop; Claude Code passes the event as JSON on stdin. It tells the mods watcher (watcher.mjs --watch,
// see claude-bridge.mjs) what's happening through a local named pipe, and starts the watcher if it
// isn't running. It never prints anything (a UserPromptSubmit hook's output would be added to the
// prompt), never blocks Claude for more than a moment, and always exits 0.
//
//   node claude-hook.mjs            (from a hook) one event on stdin
//   node claude-hook.mjs on | off   switch the Claude pet on or off
// To ask the watcher from a script (it prints the answer):
//   node claude-hook.mjs --ask      one event on stdin, like a hook; then prints the avatar's state
//                                   as JSON { outfit, phase, look } (after a prompt's topic is known)
//   node claude-hook.mjs --state    prints that state
//   node claude-hook.mjs --look L   sets the avatar style (people, single or fish), prints the state
//   node claude-hook.mjs --where W  puts the Claude pet on the window (docked), in the chat, or free
//   node claude-hook.mjs --classify topics for earlier prompts: { texts } on stdin (oldest first),
//                                   prints { outfits } (the in-chat avatar's older replies)
// Those print nothing when the watcher isn't running (it's started for the next time).
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIPE = '\\\\.\\pipe\\adaptive-avatar-claude';
const ROOT = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

const readStdin = () => new Promise(res => {
  let buf = '';
  const done = () => res(buf);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; if (buf.length > 1e6) done(); });
  process.stdin.on('end', done);
  process.stdin.on('error', done);
  setTimeout(done, 1500);
});

// One message down the pipe; false if the watcher isn't there.
const deliver = (msg, timeout = 600) => new Promise(res => {
  const sock = net.connect(PIPE);
  const t = setTimeout(() => { sock.destroy(); res(false); }, timeout);
  sock.on('connect', () => sock.end(JSON.stringify(msg) + '\n', () => { clearTimeout(t); res(true); }));
  sock.on('error', () => { clearTimeout(t); res(false); });
});

// One message that wants an answer; the answer's JSON, or null.
const ask = (msg, timeout = 6000) => new Promise(res => {
  const sock = net.connect(PIPE);
  let buf = '';
  const t = setTimeout(() => { sock.destroy(); res(null); }, timeout);
  sock.setEncoding('utf8');
  sock.on('connect', () => sock.write(JSON.stringify({ ...msg, reply: true }) + '\n'));   // and wait, open
  sock.on('data', d => { buf += d; if (buf.includes('\n')) sock.end(); });
  sock.on('close', () => { clearTimeout(t); try { res(JSON.parse(buf.split('\n')[0])); } catch { res(null); } });
  sock.on('error', () => { clearTimeout(t); res(null); });
});

function eventMessage(e) {
  const session = String(e.session_id || '');
  switch (e.hook_event_name) {
    case 'UserPromptSubmit': return typeof e.prompt === 'string' ? { type: 'prompt', session, text: e.prompt.slice(0, 2000) } : null;
    case 'PreToolUse': return { type: 'phase', session, phase: 'writing' };
    case 'Stop': return { type: 'phase', session, phase: 'idle' };
    case 'SessionStart': return { type: 'hello' };
    default: return null;
  }
}

// The watcher isn't running: start it (only where pet mode is set up), and leave a helper to deliver
// this message once it's listening, so Claude doesn't wait.
async function startWatcherAndDeliverLater(msg) {
  if (!existsSync(join(ROOT, 'pet', 'node_modules', 'electron'))) return;
  if (existsSync(join(ROOT, '.mods-off'))) return;   // turned off on purpose (tray: "Turn avatar off")
  const { startWatcher, watcherRunning } = await import('./launch.mjs');
  if (!await watcherRunning()) startWatcher();   // (one may be starting already; it retries, then quits if another holds the lock)
  if (msg.type === 'hello') return;
  const helper = spawn(process.execPath, [fileURLToPath(import.meta.url), '--deliver-later'],
    { detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  helper.stdin.end(JSON.stringify(msg));   // through stdin: the prompt stays off the command line
  helper.unref();
}

try {
  if (arg === 'on' || arg === 'off') {
    // "on kimi" / "off kimi": the Kimi pet (same window helper, same pipe).
    const kimi = process.argv[3] === 'kimi';
    const ok = await deliver(kimi ? { type: 'mode', on: arg === 'on', app: 'kimi' } : { type: 'mode', on: arg === 'on' }, 2000);
    console.log(ok ? `${kimi ? 'Kimi' : 'Claude'} pet turned ${arg}.` : 'The mods watcher is not running: open Claude (or another app with mods) and try again.');
  } else if (arg === '--deliver-later') {
    const msg = JSON.parse(await readStdin());
    for (let i = 0; i < 40; i++) {   // up to ~20 s while the watcher starts
      if (await deliver(msg)) break;
      await new Promise(r => setTimeout(r, 500));
    }
  } else if (arg === '--classify') {
    const { texts } = JSON.parse((await readStdin()) || '{}');
    const answer = Array.isArray(texts) ? await ask({ type: 'classify', texts }, 120000) : null;
    if (answer) process.stdout.write(JSON.stringify(answer));
  } else if (arg === '--ask' || arg === '--state' || arg === '--look' || arg === '--where') {
    const msg = arg === '--ask' ? eventMessage(JSON.parse((await readStdin()) || '{}')) || { type: 'state' }
      : arg === '--look' ? { type: 'look', look: String(process.argv[3] || '') }
      : arg === '--where' ? { type: 'where', where: String(process.argv[3] || '') } : { type: 'state' };
    const state = await ask(msg);
    if (state) process.stdout.write(JSON.stringify(state));
    else if (msg.type !== 'look') await startWatcherAndDeliverLater(msg);
  } else {
    const msg = eventMessage(JSON.parse((await readStdin()) || '{}'));
    if (msg && !(await deliver(msg))) await startWatcherAndDeliverLater(msg);
  }
} catch {}
process.exit(0);
