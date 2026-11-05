// Everything the tray icon says, in English and Chinese (pet/tray.js). The language is chosen in the
// tray menu (Language / 语言) and remembered; the first time, it follows Windows' display language.
//
// Every app line reads the same way: the app, the avatar's state there, and what a click does.
//   closed    the app isn't open                         click: open it with the avatar
//   open      open without the avatar                    click: restart it with the avatar
//   on        open with the avatar                       click: hide her in that app
//   hidden    open with the avatar, hidden there         click: show her
//   off       the avatar is turned off everywhere        click: turn it back on
//   stopped   the avatar's background process is gone    click: restart it
//   starting  being opened
// Claude and Kimi (a floating avatar beside their window, switched on or off) and DeepSeek Harness
// (a plugin) use the same pattern.
'use strict';

// App names in Chinese, where the app has one.
const ZH_NAMES = { doubao: '豆包', yuanbao: '元宝', qianwen: '千问' };
// In Chinese text, a space goes only between a Latin-script name (Codex, Claude) and Chinese characters.
const L = n => (/^[A-Za-z]/.test(n) ? ' ' + n : n);   // a space before it
const R = n => (/[A-Za-z]$/.test(n) ? n + ' ' : n);   // a space after it
const B = n => R(L(n));

const en = {
  title: 'AI Avatar',
  name: (id, name) => name,
  noApps: 'No supported app installed',
  app: {
    closed: n => `${n}: closed - click to open with avatar`,
    open: n => `${n}: open, no avatar - click to add her`,
    on: n => `${n}: avatar on - click to hide`,
    hidden: n => `${n}: avatar hidden - click to show`,
    off: n => `${n}: avatar turned off - click to turn back on`,
    stopped: n => `${n}: avatar stopped - click to restart`,
    starting: n => `${n}: opening...`,
  },
  docked: {
    off: n => `${n}: avatar off - click to turn on`,
    on: n => `${n}: avatar on - click to turn off`,
    starting: n => `${n}: turning on...`,
  },
  dsh: {
    closed: n => `${n}: closed - click to open with avatar`,
    open: n => `${n}: open, no avatar - click to add her`,
    on: n => `${n}: avatar on (plugin)`,
    starting: n => `${n}: opening...`,
  },
  restart: 'Restart avatar',
  turnOff: 'Turn avatar off',
  turnBackOn: 'Turn avatar back on',
  startWithWindows: 'Start with Windows',
  feedback: 'Give feedback (open a website)',
  openLog: 'Open log',
  exit: 'Exit',
  language: 'Language / 语言',
  tip: {
    gaveUp: t => `${t} - stopped (see log)`,
    onIn: (t, names) => `${t} - on in ${names.join(', ')}`,
    off: t => `${t} - turned off`,
    idle: t => `${t} - no app open with it`,
  },
  restartAsk: {
    message: n => `${n} is open without the avatar.`,
    detail: (n, loses) => `To add it, ${n} has to restart.\n\n${loses}`,
    restart: n => `Restart ${n}`,
    cancel: 'Cancel',
  },
  loses: id => id === 'codex' ? 'Any agent task that is running right now would be interrupted.'
    : 'An unsent message or an answer that is still being written would be lost.',
  ok: 'OK',
  balloon: {
    opened: n => `${n} is open with the avatar.`,
    openFailed: (n, why) => `Could not open ${n} with the avatar. ${why}`,
    dockedOn: n => `The ${n} avatar is on. She stands beside ${n}'s chat box while it's open.`,
    dockedOnFailed: (n, why) => `Could not turn the ${n} avatar on. ${why}`,
    dockedOff: n => `The ${n} avatar is off.`,
    dshOpening: 'DeepSeek Harness is opening with the avatar.',
    dshAdded: 'The avatar was added to DeepSeek Harness. Close DeepSeek Harness and open it again to see her.',
    dshFailed: 'Could not add the avatar to DeepSeek Harness. See the log.',
    restarting: 'The avatar is restarting. She will be back in a few seconds.',
    turnedOff: 'The avatar is off. Choose "Turn avatar back on" to bring her back.',
    gaveUp: 'The avatar keeps stopping, so it was left off. Open the log to see why, or choose Restart avatar.',
    restartedItself: 'The avatar stopped unexpectedly and was restarted.',
  },
};

const zh = {
  title: 'AI 头像',
  name: (id, name) => ZH_NAMES[id] || name,
  noApps: '没有安装支持的应用',
  app: {
    closed: n => `${n}：未打开 - 点击打开并显示头像`,
    open: n => `${n}：已打开，没有头像 - 点击添加`,
    on: n => `${n}：头像已显示 - 点击隐藏`,
    hidden: n => `${n}：头像已隐藏 - 点击显示`,
    off: n => `${n}：头像已关闭 - 点击重新开启`,
    stopped: n => `${n}：头像已停止 - 点击重启`,
    starting: n => `${n}：正在打开…`,
  },
  docked: {
    off: n => `${n}：头像未开启 - 点击开启`,
    on: n => `${n}：头像已开启 - 点击关闭`,
    starting: n => `${n}：正在开启…`,
  },
  dsh: {
    closed: n => `${n}：未打开 - 点击打开并显示头像`,
    open: n => `${n}：已打开，没有头像 - 点击添加`,
    on: n => `${n}：头像已开启（插件）`,
    starting: n => `${n}：正在打开…`,
  },
  restart: '重启头像',
  turnOff: '关闭头像',
  turnBackOn: '重新开启头像',
  startWithWindows: '开机自动启动',
  feedback: '反馈意见（打开网页）',
  openLog: '打开日志',
  exit: '退出',
  language: 'Language / 语言',
  tip: {
    gaveUp: t => `${t} - 已停止（请查看日志）`,
    onIn: (t, names) => `${t} - 已在${B(names.join('、'))}中开启`,
    off: t => `${t} - 已关闭`,
    idle: t => `${t} - 没有打开的应用`,
  },
  restartAsk: {
    message: n => `${R(n)}已打开，但没有头像。`,
    detail: (n, loses) => `要添加头像，需要重启${L(n)}。\n\n${loses}`,
    restart: n => `重启${L(n)}`,
    cancel: '取消',
  },
  loses: id => id === 'codex' ? '正在运行的智能体任务会被中断。' : '未发送的消息或正在生成的回答会丢失。',
  ok: '确定',
  balloon: {
    opened: n => `${R(n)}已打开，头像已显示。`,
    openFailed: (n, why) => `无法打开带头像的${L(n)}。${why}`,
    dockedOn: n => `${R(n)}头像已开启。${R(n)}打开时，她会站在输入框旁边。`,
    dockedOnFailed: (n, why) => `无法开启${B(n)}头像。${why}`,
    dockedOff: n => `${R(n)}头像已关闭。`,
    dshOpening: '正在打开带头像的 DeepSeek Harness。',
    dshAdded: '头像已添加到 DeepSeek Harness。请关闭 DeepSeek Harness 后重新打开，就能看到她。',
    dshFailed: '无法把头像添加到 DeepSeek Harness，请查看日志。',
    restarting: '头像正在重启，几秒后就会回来。',
    turnedOff: '头像已关闭。选择“重新开启头像”可以让她回来。',
    gaveUp: '头像反复停止，已暂时关闭。请打开日志查看原因，或选择“重启头像”。',
    restartedItself: '头像意外停止，已自动重启。',
  },
};

const LANGS = { en, zh };
// The choices in the Language menu, each in its own language.
const LANGUAGE_NAMES = { en: 'English', zh: '中文' };
// Windows' display language -> 'zh' or 'en' (Chinese if any preferred language is Chinese and comes first).
const defaultLang = locales => (String((locales || [])[0] || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');

module.exports = { LANGS, LANGUAGE_NAMES, defaultLang };
