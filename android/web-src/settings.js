// The setup screen. window.App is MainActivity's bridge:
//   App.state() -> JSON { on, enabled, always, size, docked, apps: [{ pkg, name, zh }], perf: [lines] }
//   App.<action>(...) for each button and setting.
// It speaks one language: the phone's (Chinese on a Chinese phone, else English), like her menu.
'use strict';
const ZH = String(navigator.language || '').toLowerCase().startsWith('zh');
document.documentElement.lang = ZH ? 'zh-CN' : 'en';
const $ = id => document.getElementById(id);

// Each text in English and Chinese (a few have <b>: our own fixed strings, so innerHTML is fine).
const T = {
  tagline: ['An expert walks in and attaches to your AI chat app’s input box to match what you ask about, and reacts while it answers.',
    '根据你提问的话题，对口的专家会走过来，依靠在 AI 聊天应用的输入框旁，并在 AI 回答时做出反应。'],
  on: ['On', '已开启'], off: ['Off', '未开启'],
  ready: ['She’s ready in your chat apps.', '她已在聊天应用中待命。'],
  hiddenOn: ['On, but hidden (Show her is off).', '已开启，但已隐藏（“显示头像”已关闭）。'],
  tapOn: ['Tap Switch her on below.', '点下面的“开启”。'],
  allowOnce: ['Android asks you to allow her once, on her own switch page: turn the switch on, then tap <b>Allow</b>.',
    'Android 需要你允许一次：在她的开关页面打开开关，然后点<b>允许</b>。'],
  switchOn: ['Switch her on', '开启'],
  restricted: ['Switch greyed out (“Restricted setting”)? App info → ⋮ → <b>Allow restricted settings</b>, then try again.',
    '开关是灰色的（“受限制的设置”）？应用信息 → ⋮ → <b>允许受限制的设置</b>，然后再试。'],
  appInfo: ['App info', '应用信息'],
  turnOff: ['Turn her off completely', '完全关闭'],
  turnOffNote: ['Stops her service: no battery or memory use. To bring her back, tap Switch her on again.',
    '完全停止她的服务，不再耗电或占用内存。要重新开启，再点一次“开启”即可。'],
  openApp: ['Open a chat app', '打开聊天应用'],
  noApps: ['Install a supported AI chat app first.', '请先安装支持的 AI 聊天应用。'],
  howTo: ['Press and hold her for her menu; drag her to move her.', '长按她打开菜单，拖动可以移动她。'],
  settings: ['Settings', '设置'],
  showHer: ['Show her', '显示头像'],
  showHerNote: ['Off: hidden, and her page and topic model are freed. Switching back is instant.',
    '关闭：头像隐藏，页面和话题模型会被释放。重新打开即可立刻显示。'],
  always: ['Stay on screen in other apps', '在其他应用中也显示'],
  alwaysNote: ['She stays where she was, with the last expert. Other apps are never read.',
    '她会留在原来的位置，保持上一位专家。不会读取其他应用的内容。'],
  size: ['Size', '大小'],
  where: ['Where she stands', '位置'],
  docked: ['Attached to the chat box (follows it).', '依靠在输入框旁（跟随输入框）。'],
  free: ['Where you dragged her.', '你拖到的位置。'],
  dock: ['Attach her to the chat box again', '重新依靠在输入框旁'],
  perf: ['Performance', '性能'],
  clear: ['Clear', '清除'],
  disclaimer: ['<b>Unofficial:</b> not affiliated with any of the chat apps.',
    '<b>非官方项目</b>，与这些聊天应用均无关联。'],
  privacy: ['<b>Privacy:</b> no internet access. She reads only the supported chat apps’ screens (your question, whether the AI is answering, where the chat box is). The topic is picked on your phone by a small AI model; nothing is saved or sent anywhere.',
    '<b>隐私：</b>本应用没有联网权限，只读取支持的聊天应用的屏幕（你的问题、AI 是否在回答、输入框的位置）。话题由手机上的小型 AI 模型判断，不会保存或发送任何内容。'],
};
const t = key => T[key][ZH ? 1 : 0];
for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = t(el.dataset.t);

let state = {};
function render() {
  try { state = JSON.parse(App.state()); } catch { return; }
  const pill = $('pill');
  pill.className = 'pill ' + (state.on ? 'on' : 'off');
  pill.textContent = t(state.on ? 'on' : 'off');
  $('what').textContent = state.on ? t(state.enabled ? 'ready' : 'hiddenOn') : t('tapOn');
  $('off-part').hidden = state.on;
  $('on-part').hidden = !state.on;

  const apps = $('apps');
  apps.replaceChildren(...state.apps.map(a => {
    const b = document.createElement('button');
    b.className = 'app';
    b.innerHTML = '<span><b></b></span><span class="go">›</span>';
    b.querySelector('b').textContent = ZH && a.zh ? a.zh : a.name;
    b.onclick = () => App.openApp(a.pkg);
    return b;
  }));
  $('no-apps').hidden = state.apps.length > 0;

  $('enabled').checked = state.enabled;
  $('always').checked = state.always;
  $('size').value = Math.round(state.size * 100);
  $('size-out').textContent = Math.round(state.size * 100) + '%';
  $('where-text').textContent = t(state.docked ? 'docked' : 'free');
  $('dock').hidden = state.docked;

  $('perf').replaceChildren(...state.perf.map(line => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  App[b.dataset.act]();
  setTimeout(render, 300);
});
$('enabled').onchange = e => { App.setEnabled(e.target.checked); render(); };
$('always').onchange = e => { App.setAlways(e.target.checked); render(); };
$('size').oninput = e => { $('size-out').textContent = e.target.value + '%'; };
$('size').onchange = e => { App.setSize(Number(e.target.value) / 100); render(); };

window.render = render;   // MainActivity calls it on resume
render();
