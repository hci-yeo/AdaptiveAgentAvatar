// Her menu window on the phone: shows the menu her page built (as pet/menu.js does on the desktop),
// reports which item was tapped, and closes when you tap outside it (the app watches for that).
'use strict';
const MARGIN = 12;   // room around the menu for its shadow

const style = document.createElement('style');
document.head.append(style);

// Her menu speaks the phone's language (as her page does: avatar-bundle.mjs LANG), and so do the
// phone's own lines below.
const ZH = String(navigator.language || '').toLowerCase().startsWith('zh');

// Desktop pet wording -> phone wording (whole text of one line each), in English and in Chinese.
const PHONE_WORDS = [
  [/^.+'s avatar$/, 'Your AI avatar'],
  [/^.+的头像$/, '你的 AI 头像'],
  [/^Pick a spot on the .+ window, or drag her$/, 'Attached to the chat box, or drag her anywhere'],
  [/^在.+窗口上选一个位置，或拖动她$/, '依靠在输入框旁，或拖到任意位置'],
  [/^Beside the .+ chat box$/, 'Attach to the chat box'],
  [/^在.+的输入框旁边$/, '依靠在输入框旁'],
  [/^Float freely on the desktop$/, 'Stay where I drag her'],
  [/^自由浮在桌面上$/, '停在我拖到的位置'],
  [/^Hide her \(turn the .+ pet off\)$/, 'Hide her'],
  [/^隐藏她（关闭.+宠物）$/, '隐藏她'],
  [/^(?!This app only$).+ only$/, 'On this phone', 'title'],   // the section title only
  [/^仅限(?!此应用$).+$/, '这部手机', 'title'],
];

window.__menuShow = ({ html, css, corner, here, always }) => {
  style.textContent = css;
  document.body.innerHTML = html;
  const menu = document.getElementById('doubao-mods-avatar-menu');
  if (!menu) return AndroidMenu.close();
  // The menu is the desktop pet's, which belongs to one app ("ChatGPT only", "Beside the ChatGPT chat
  // box"). On the phone she serves every supported chat app, so those lines say so.
  const walker = document.createTreeWalker(menu, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    for (const [re, to, only] of PHONE_WORDS) {
      if (only && !n.parentElement?.classList.contains(only)) continue;
      if (re.test(t)) { n.nodeValue = t.replace(re, to); break; }
    }
  }
  // The phone's own choice, at the end of the menu: stay on screen after leaving the chat app.
  const item = document.createElement('div');
  item.className = 'item';
  item.dataset.android = 'always';
  item.innerHTML = '<span class="tick"></span><span></span>';
  item.firstChild.textContent = always ? '✓' : '';
  item.lastChild.textContent = ZH ? '📌 在其他应用中也显示' : '📌 Stay on screen in other apps';
  menu.append(item);
  menu.style.position = 'relative';
  menu.style.left = menu.style.top = 'auto';
  menu.style.margin = MARGIN + 'px';
  menu.style.maxHeight = 'none';
  // "Where she stands": the corner she's in, or a dot where she is on the screen.
  for (const q of menu.querySelectorAll('[data-corner]')) q.classList.toggle('dm-on', q.dataset.corner === corner);
  const dot = menu.querySelector('.dm-here');
  if (dot && !corner && here) {
    dot.hidden = false;
    dot.style.left = Math.max(8, Math.min(92, here.x * 100)) + '%';
    dot.style.top = Math.max(14, Math.min(86, here.y * 100)) + '%';
  }
  const r = menu.getBoundingClientRect();
  AndroidMenu.size(Math.ceil(r.width) + MARGIN * 2, Math.ceil(r.height) + MARGIN * 2);
  scrollTo(0, 0);
};

document.addEventListener('click', e => {
  const own = e.target.closest('[data-android]');
  if (own) return AndroidMenu.act(own.dataset.android);
  const item = e.target.closest('[data-k]');
  if (item) AndroidMenu.pick(Number(item.dataset.k));
  else if (!e.target.closest('#doubao-mods-avatar-menu')) AndroidMenu.close();   // the shadow margin
});
document.addEventListener('contextmenu', e => e.preventDefault());
