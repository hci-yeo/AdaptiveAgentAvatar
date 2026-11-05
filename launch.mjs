// Open Doubao, Codex, Yuanbao, Qwen or Qianwen (千问) with the avatar: start the app with its DevTools port (127.0.0.1
// only), then make sure the background watcher (watcher.mjs --watch) and the tray icon (pet/tray.js)
// are running. Plain Node: no PowerShell, no WMI, nothing compiled on the fly.
//
// Usage: node launch.mjs <doubao|codex|yuanbao|qwen|qianwen|cursor> [--yes] [--no-tray]
//        node launch.mjs claude|kimi [--no-tray]   the Claude or Kimi desktop app: they refuse a DevTools port,
//                                             so nothing restarts; this switches its docked pet on
//   --yes      restart an app that's open without the avatar, without asking (the tray asks itself)
//   --no-tray  don't start the tray icon (the tray uses this when it runs the launcher)
// Exit codes: 0 ok, 1 error, 2 you chose not to restart the app.
//
// How each app gets its port:
//   Doubao   Chromium switch on its own program file
//   Codex    the Microsoft Store app's own command alias (WindowsApps\chatgpt-desktop.exe), which
//            starts it the official way, with its package identity, and passes the switches on
//   Yuanbao  WebView2 reads its switches from WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, set for it alone
//   Qwen     Chromium switch on its own program file (Electron)
//   Qianwen  Chromium switch on its own program file (its own Chromium build, like Doubao)
//   Cursor   Chromium switch on its own program file (Electron)
import { spawn, execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { APPS } from './apps.mjs';
import { tr } from './lang.mjs';   // messages in the language chosen in the tray
import { IS_MAC, LOCK_PATH, lockHeldUnix, pidsOfImage, pidsOfPackage as pidsOfStorePackage, pidsInBundle,
  askToClose, forceClose, findMacApp, macExecutable, macAppName } from './platform.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOCAL = process.env.LOCALAPPDATA || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exec = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true }, (err, out) => res(String(out || ''))));

// Process ids of running programs (Windows: by file name; Store apps: by package. See platform.mjs).
const pidsOf = pidsOfImage;
const pidsOfPackage = pidsOfStorePackage;
// reg.exe writes in the console's code page (936 on Chinese Windows), not UTF-8: decoded as UTF-8,
// a folder like C:\Users\张三\... came out garbled and the app looked "not installed".
const CODE_PAGES = { 936: 'gbk', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr', 65001: 'utf-8', 866: 'ibm866',
  874: 'windows-874', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253',
  1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258' };
let consoleDecoder = null;
async function decodeConsole(buf) {
  if (!consoleDecoder) {
    const cp = Number((await exec('chcp.com', [])).match(/(\d+)\s*$/)?.[1]);
    try { consoleDecoder = new TextDecoder(CODE_PAGES[cp] || 'utf-8'); } catch { consoleDecoder = new TextDecoder('utf-8'); }
  }
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? consoleDecoder.decode(buf) : utf8;
}
async function regValue(key, name) {
  const buf = await new Promise(res => execFile('reg', ['query', key, '/v', name], { windowsHide: true, encoding: 'buffer' },
    (err, out) => res(Buffer.isBuffer(out) ? out : Buffer.alloc(0))));
  return (await decodeConsole(buf)).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`))?.[1]?.trim() || null;
}
// The first of these folders that holds the program (registry entries can be stale or unreadable).
const firstWith = (file, dirs) => {
  const found = dirs.filter(Boolean).map(d => join(d, file));
  return found.find(p => existsSync(p)) || found.at(-1);
};

const debugArgs = port => [`--remote-debugging-port=${port}`, `--remote-allow-origins=http://127.0.0.1:${port}`];
const KEEP_DRAFTS = 'An unsent message or an answer that is still being written would be lost.';

const WIN_LAUNCH = {
  doubao: {
    exe: async () => join(LOCAL, 'Doubao', 'Application', 'app', 'Doubao.exe'),
    pids: () => pidsOf('Doubao.exe'),
    start: port => ({ args: debugArgs(port) }),
    loses: KEEP_DRAFTS,
  },
  codex: {
    exe: async () => join(LOCAL, 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe'),
    // A command alias is a special link Node can start but not "see" (existsSync says no), so look it up.
    installed: exe => { try { return readdirSync(dirname(exe)).includes(basename(exe)); } catch { return false; } },
    pids: () => pidsOfPackage('ChatGPT.exe', 'OpenAI.Codex_'),
    start: port => ({ args: debugArgs(port) }),
    loses: 'Any agent task that is running right now would be interrupted.',
  },
  yuanbao: {
    exe: async () => {
      return firstWith('yuanbao.exe', [
        await regValue('HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Yuanbao', 'InstallLocation'),
        await regValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Yuanbao', 'InstallLocation'),
        'C:\\Program Files\\Tencent\\Yuanbao',
      ]);
    },
    pids: () => pidsOf('yuanbao.exe'),
    start: port => ({ args: [], env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: debugArgs(port).join(' ') } }),
    loses: KEEP_DRAFTS,
    // Its WebView2 browser closes a moment after it; a new one started too soon would join it.
    settle: 3000,
  },
  qwen: {
    // Alibaba's international app (English); 千问 below is its domestic (Chinese) app.
    exe: async () => join(LOCAL, 'Programs', 'Qwen', 'Qwen.exe'),
    pids: () => pidsOf('Qwen.exe'),
    start: port => ({ args: debugArgs(port) }),
    loses: KEEP_DRAFTS,
  },
  cursor: {
    // Installed for all users (Program Files) or just for you (AppData\Local\Programs).
    exe: async () => firstWith('Cursor.exe', [
      join(LOCAL, 'Programs', 'cursor'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'cursor'),
    ]),
    pids: () => pidsOf('Cursor.exe'),
    start: port => ({ args: debugArgs(port) }),
    loses: 'Any agent that is running right now would be interrupted (Cursor asks about unsaved files first).',
  },
  qianwen: {
    // Its per-user install (Inno Setup); its uninstall entry's InstallLocation if it's elsewhere.
    exe: async () => {
      return firstWith('qianwen.exe', [
        await regValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{FB65B538-F812-49D2-9DD8-FFB5082D4544}_is1', 'InstallLocation'),
        join(LOCAL, 'Programs', 'QianwenApp'),
      ]);
    },
    pids: () => pidsOf('qianwen.exe'),
    start: port => ({ args: debugArgs(port) }),
    loses: KEEP_DRAFTS,
  },
};

// macOS: each app is an .app bundle, found by its likely names (or Spotlight, by bundle id), started
// with `open -a <app> --args <switches>` and closed with AppleScript's "quit". The names and bundle ids
// are first guesses, to check on a real Mac (MAC-CHECKLIST.md); an app that turns out not to be
// Chromium-based (a native Mac app) can't take a debugging port and would need an overlay instead.
function macApp(names, bundleIds, extra = {}) {
  const find = () => findMacApp(names, bundleIds);
  return {
    app: async () => find(),
    exe: async () => macExecutable(find()) || `/Applications/${names[0]}.app`,
    pids: async () => pidsInBundle(find()),
    quitName: () => macAppName(find()),
    start: port => ({ args: debugArgs(port) }),
    loses: KEEP_DRAFTS,
    ...extra,
  };
}
const MAC_LAUNCH = {
  // checked (Doubao 2.34.6): /Applications/Doubao.app is a launcher; it passes the switches on to its
  // own Chromium (Contents/Helpers/Doubao Browser.app), and the chat page is doubao://doubao-chat/ as on Windows.
  doubao: macApp(['Doubao', '豆包'], ['com.bot.pc.doubao']),
  codex: macApp(['ChatGPT', 'Codex'], ['com.openai.codex'],   // checked: on macOS the Codex app is "ChatGPT.app"
    { loses: 'Any agent task that is running right now would be interrupted.' }),
  yuanbao: macApp(['Yuanbao', '元宝', '腾讯元宝'], ['com.tencent.yuanbao', 'com.tencent.hunyuan.app']),
  qwen: macApp(['Qwen'], ['ai.qwen.app', 'com.alibaba.qwen']),
  cursor: macApp(['Cursor'], ['com.todesktop.230313mzl4w4u92'], { loses: WIN_LAUNCH.cursor.loses }),
  qianwen: macApp(['Qianwen', '千问', '通义', 'QianwenApp'], ['com.aliyun.tongyi', 'com.alibaba.qianwen']),
};

export const LAUNCH = IS_MAC ? MAC_LAUNCH : WIN_LAUNCH;

// Is the app's chat page answering on its port?
export async function portOpen(id) {
  const app = APPS[id];
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).some(app.isTarget);
  } catch { return false; }
}
// Does the app's debugging port answer at all, whatever page it shows? (Started with the avatar, but
// its chat page isn't there yet: still loading, on its sign-in page, or its window closed to the tray.)
export async function portUp(id) {
  try {
    const res = await fetch(`http://127.0.0.1:${APPS[id].port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

// ---- The watcher and the tray -------------------------------------------------------------------
const PID_FILE = join(ROOT, '.watcher.pid');
export const OFF_FLAG = join(ROOT, '.mods-off');
// Node: the copy shipped next to the mods (node\node.exe) if there is one, else the one running this
// (inside the tray, that's Electron, so then Node from PATH; the AI library is built for real Node).
// (Windows ships node\node.exe; a macOS package would ship node/bin/node.)
const SHIPPED_NODE = IS_MAC ? join(ROOT, 'node', 'bin', 'node') : join(ROOT, 'node', 'node.exe');
export const ELECTRON = IS_MAC ? join(ROOT, 'pet', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(ROOT, 'pet', 'node_modules', 'electron', 'dist', 'electron.exe');
// Inside the menu-bar app (Electron) on macOS there's no Terminal PATH: look where Node is usually put.
const MAC_NODES = [join(homedir(), '.local', 'node', 'bin', 'node'), '/opt/homebrew/bin/node', '/usr/local/bin/node'];
// macOS: inside the AI Avatar app (this folder is in an .app bundle), or with no Node installed, the
// pet program's own Electron runs the Node scripts (ELECTRON_RUN_AS_NODE: it then is plain Node 24,
// and the AI library loads in it), so there's nothing to install.
const IN_MAC_APP = IS_MAC && ROOT.includes('.app/Contents/');
const macNode = () => (!IN_MAC_APP && MAC_NODES.find(p => existsSync(p))) || (existsSync(ELECTRON) ? ELECTRON : 'node');
export const NODE = existsSync(SHIPPED_NODE) ? SHIPPED_NODE
  : !process.versions.electron && !IN_MAC_APP ? process.execPath
  : IS_MAC ? macNode() : 'node';
/** The environment for running NODE: when NODE is Electron, the switch that makes it plain Node. */
export const NODE_ENV = { ...process.env, ...(NODE === ELECTRON ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// One watcher per Windows user, whichever copy of this folder it runs from: it holds this named pipe
// for as long as it runs (Windows lets only one process create a pipe name, and the name goes away
// with the process). So the pipe also says whether a watcher is running, even after a crash, a
// reboot or a reused process id, which the pid file alone couldn't tell.
// (macOS: a Unix socket file instead of a pipe; see platform.mjs.)
export const WATCHER_LOCK = LOCK_PATH;
// Asked by trying to take the name for a moment: in use means a watcher holds it. (Looking the pipe up
// by name instead, e.g. existsSync, uses up one of its connections, and a second look right after
// could say "no".) A watcher starting in that same moment retries (watcher.mjs takeWatcherLock).
export function watcherRunning() {
  if (IS_MAC) return lockHeldUnix();   // a socket file can outlive its watcher: ask it instead
  return new Promise(resolve => {
    const probe = createServer();
    probe.once('error', e => resolve(e.code !== 'ENOENT'));   // EADDRINUSE: held
    probe.listen(WATCHER_LOCK, () => probe.close(() => resolve(false)));
  });
}
// This folder's watcher's process id (0 if it isn't running, or another copy's watcher is).
export async function watcherPid() {
  let pid = 0;
  try { pid = Number(readFileSync(PID_FILE, 'utf8')); } catch { return 0; }
  return pid && alive(pid) && await watcherRunning() ? pid : 0;
}

// Claude, Kimi (no debugging port; their pet is docked to their window): is the app running, even
// with its window hidden or closed to the tray? Claude: only the Store app's own processes (Claude
// Code on the command line is also claude.exe). A process list takes ~0.3 s, so callers throttle it.
export async function dockedAppRunning(id) {
  if (IS_MAC) return false;   // their window helper (pet\claude-dock.cs) is Windows-only; a macOS one is to come
  if (id === 'claude') return (await pidsOfPackage('claude.exe', 'Claude_')).length > 0;
  if (id === 'kimi') return (await pidsOf('Kimi.exe')).length > 0;
  return false;
}

// Hidden background process; it exits by itself once no app is open. Output -> mods-log.txt
export function startWatcher() {
  const log = openSync(join(ROOT, 'mods-log.txt'), 'w');
  const child = spawn(NODE, ['watcher.mjs', '--watch'], { cwd: ROOT, env: NODE_ENV, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.unref();
  closeSync(log);
  return child.pid;
}

function startTray() {
  if (!existsSync(ELECTRON)) return false;
  // One tray only: a second copy quits by itself (Electron's single-instance lock).
  spawn(ELECTRON, [join(ROOT, 'pet', 'tray.js')], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  return true;
}

// ---- Open one app -------------------------------------------------------------------------------
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^\s*(y|是)/i.test(await rl.question(question)); } finally { rl.close(); }
}

// An app's name for a Chinese sentence: its Chinese name (豆包), or its English one with spaces around
// it (" Codex "), trimmed at the start or end of the sentence by the caller.
const zhName = id => { const n = ZH_NAMES[id] || APPS[id]?.name || id; return /[A-Za-z]/.test(n) ? ` ${n} ` : n; };
const zhSay = s => s.replace(/^ | $/g, '').replace(/ ([，。？！：（）])/g, '$1');

async function closeGently(how, name, id) {
  let pids = await how.pids();
  console.log(tr(`Closing ${name}...`, zhSay(`正在关闭${zhName(id)}…`)));
  // Like clicking X: taskkill without /F asks each window to close, so the app can save (macOS: "quit").
  await askToClose(pids, { appName: how.quitName?.() });
  for (let i = 0; i < 10 && (pids = await how.pids()).length; i++) await sleep(1000);
  // Closing the window often only hides the app in the tray; then end it. Only its own processes (the
  // list above holds all of them): no /T, which also ended whatever it had opened (a browser, Word or
  // WPS started from an answer), losing unsaved work there. Its embedded browser parts end by themselves.
  if (pids.length) {
    await forceClose(pids);
    await sleep(1500);
  }
  if (how.settle) await sleep(how.settle);
}

export async function isInstalled(id) {
  const how = LAUNCH[id], exe = await how.exe();
  return how.installed ? how.installed(exe) : existsSync(exe);
}

// What to tell the user when an app update has probably broken the avatar (README: "Known
// limitation"). Two cases:
//   noPortNotice      the app starts, but its debugging port never answers (the feature was removed
//                     or changed). The Start files print it; the tray shows it in a box.
//   noChatBoxNotice   the app connects, but its page never shows the chat box the avatar stands
//                     beside (the page was redesigned). The watcher notices it (watcher.mjs) and the
//                     tray shows it in a box.
export const TESTED_WITH = { en: 'Doubao 2.32 · Codex 26.1027 · Yuanbao 2.90 · Qianwen 5.1 · Cursor 3.19', zh: '豆包 2.32 · Codex 26.1027 · 元宝 2.90 · 千问 5.1 · Cursor 3.19' };
const ZH_NAMES = { doubao: '豆包', yuanbao: '元宝', qianwen: '千问' };
function notice(id, { title, why, zhTitle, zhWhy }) {
  const name = APPS[id].name, zh = ZH_NAMES[id] || name, sp = /[A-Za-z]$/.test(zh) ? ' ' : '';
  const fill = (s, n) => s.replaceAll('{name}', n).replaceAll('{zh}', zh + sp);
  return {
    title: fill(title, name),
    en: `${fill(why, name)} ${name} itself keeps working normally; only the avatar won't appear. `
      + `Nothing on your PC or in your account is harmed. We'll try to adapt when we can, but can't promise a fix.\n`
      + `Tested with: ${TESTED_WITH.en}.`,
    zh: `${fill(zhTitle)}${fill(zhWhy)}${zh}${sp}本身照常使用，只是头像不会出现，你的电脑和账号都不会受影响。`
      + `我们会尽量适配，但无法保证一定能修复。\n已测试版本：${TESTED_WITH.zh}。`,
  };
}
export const noPortNotice = id => notice(id, {
  title: '{name} opened, but the avatar couldn\'t connect to it.',
  why: 'This can happen after an app update. The avatar connects through a built-in debugging feature, which {name} may have removed or changed.',
  zhTitle: '{zh}已打开，但头像无法连接。',
  zhWhy: '这可能是软件更新造成的：头像依赖的内置调试功能可能已被关闭或修改。',
});
export const noChatBoxNotice = id => notice(id, {
  title: '{name} is open, but the avatar can\'t find its chat box.',
  why: '{name} may have redesigned its page in an update, so the avatar has nowhere to stand. '
    + '(If you\'re on a sign-in or settings page, open a chat: she appears beside its chat box.)',
  zhTitle: '{zh}已打开，但头像找不到输入框。',
  zhWhy: '{zh}可能在更新中修改了页面，头像没有位置可以显示。（如果你在登录或设置页面，请打开一个对话，她会出现在输入框旁边。）',
});

export async function openApp(id, { yes = false } = {}) {
  const app = APPS[id], how = LAUNCH[id];
  const exe = await how.exe();
  const zn = zhName(id);
  if (!(how.installed ? how.installed(exe) : existsSync(exe))) {
    console.log(tr(`${app.name} is not installed (looked for ${exe}).`, zhSay(`${zn}没有安装（查找位置：${exe}）。`)));
    return 1;
  }

  if (await portOpen(id)) {
    console.log(tr(`${app.name} is already running with the avatar (port ${app.port}).`, zhSay(`${zn}已经带着头像运行（端口 ${app.port}）。`)));
  } else if (await portUp(id)) {
    // Started with the avatar already; its chat page just isn't showing yet. Restarting it would only
    // lose work: the avatar joins the chat page as soon as it appears.
    console.log(tr(`${app.name} is already running with the avatar (port ${app.port}); she appears once its chat page shows.`,
      zhSay(`${zn}已经带着头像运行（端口 ${app.port}），聊天页面出现后她就会出现。`)));
  } else {
    if ((await how.pids()).length) {
      if (!yes) {
        console.log(tr(`${app.name} is open without the avatar. To add it, ${app.name} has to restart.`,
          zhSay(`${zn}已打开，但没有头像。要添加头像，需要重启${zn}。`)));
        console.log(tr(how.loses, id === 'codex' ? '正在运行的智能体任务会被中断。' : id === 'cursor' ? '正在运行的 Agent 会被中断（未保存的文件 Cursor 会先询问）。' : '未发送的消息或正在生成的回答会丢失。'));
        if (!await ask(tr(`Restart ${app.name} now? (y/n) `, zhSay(`现在重启${zn}吗？(y/n) `) + ' '))) {
          console.log(tr(`OK, ${app.name} was left as it is.`, zhSay(`好的，${zn}保持原样。`)));
          return 2;
        }
      }
      await closeGently(how, app.name, id);
    }
    // The port listens on 127.0.0.1 only; while it's open, programs on this PC can control the app.
    const { args, env } = how.start(app.port);
    if (IS_MAC) spawn('open', ['-a', await how.app(), '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
    else spawn(exe, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...env } }).unref();
    let up = false;
    // The port, not yet the chat page: a slow start or a sign-in page isn't "the port never answered".
    for (let i = 0; i < 45 && !up; i++) { await sleep(1000); up = await portUp(id); }
    if (!up) {
      const n = noPortNotice(id);
      console.log(`${n.title}\n(Its debugging port ${app.port} never answered.)\n\n${n.en}\n\n${n.zh}`);
      return 1;
    }
    console.log(tr(`${app.name} is up with the avatar's port ${app.port}.`, zhSay(`${zn}已启动，头像端口 ${app.port}。`)));
  }
  return 0;
}

// ---- Command line -------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const id = argv.find(a => !a.startsWith('--'));
  if (id === 'claude' || id === 'kimi') {
    // Claude, Kimi: start the watcher (and tray) if needed, then switch the docked pet on through the
    // watcher's local pipe (claude-hook.mjs on [kimi]), waiting while a fresh watcher starts listening.
    // Neither app restarts: they refuse a DevTools port, so their pet is read off their window instead.
    const name = id === 'kimi' ? 'Kimi' : 'Claude';
    if (!existsSync(ELECTRON)) {
      console.log(tr(`The ${name} pet needs the pet program (Electron, in the pet folder). Use the ready-to-run download, or run "npm install" in the pet folder.`,
        `${name} 宠物需要宠物程序（pet 文件夹里的 Electron）。请使用开箱即用的下载包，或在 pet 文件夹里运行 "npm install"。`));
      process.exit(1);
    }
    rmSync(OFF_FLAG, { force: true });
    if (!await watcherRunning()) startWatcher();
    if (!argv.includes('--no-tray')) startTray();
    for (let i = 0; i < 30; i++) {
      const r = spawnSync(NODE, [join(ROOT, 'claude-hook.mjs'), 'on', ...(id === 'kimi' ? ['kimi'] : [])], { cwd: ROOT, env: NODE_ENV, encoding: 'utf8', windowsHide: true });
      if (/turned on/.test(r.stdout || '')) {
        console.log(tr(`The ${name} pet is on. She appears on the ${name} window while it is open.`, `${name} 宠物已开启。${name} 打开时，她会出现在它的窗口上。`));
        process.exit(0);
      }
      await sleep(1000);
    }
    console.log(tr('Could not reach the background process. See mods-log.txt.', '无法连接后台进程，请查看 mods-log.txt。'));
    process.exit(1);
  }
  if (!LAUNCH[id]) { console.log(`Usage: node launch.mjs <${Object.keys(LAUNCH).join('|')}> [--yes] [--no-tray]`); process.exit(1); }
  const code = await openApp(id, { yes: argv.includes('--yes') });
  if (code === 0) {
    rmSync(OFF_FLAG, { force: true });   // opening an app with the avatar undoes "Turn avatar off"
    if (await watcherRunning()) console.log(tr('The avatar is already running (it picks up this app by itself).', '头像已在运行（会自动接上这个应用）。'));
    else { startWatcher(); console.log(tr('The avatar is on.', '头像已开启。')); }
    if (!argv.includes('--no-tray') && !startTray()) {
      console.log(tr('(The tray icon needs the pet program; run "npm install" in the pet folder to add it.)', '（托盘图标需要宠物程序；在 pet 文件夹里运行 "npm install" 即可添加。）'));
    }
  }
  process.exit(code);
}
