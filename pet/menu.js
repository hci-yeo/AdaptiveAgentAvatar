// The pet's menu window: shows the menu the pet's page built (same look and choices as in the app),
// reports which item was clicked, and closes on Esc (the main process closes it when it loses focus).
'use strict';
const MARGIN = 12;   // room around the menu for its shadow

const style = document.createElement('style');
document.head.append(style);

window.menuBridge.onShow(({ html, css, corner, here }) => {
  style.textContent = css;
  document.body.innerHTML = html;
  const menu = document.getElementById('doubao-mods-avatar-menu');
  if (!menu) return window.menuBridge.close();
  menu.style.left = MARGIN + 'px';
  menu.style.top = MARGIN + 'px';
  menu.style.maxHeight = 'none';
  // "Where she stands": the corner she's in, or a dot where she is on the screen.
  for (const q of menu.querySelectorAll('[data-corner]')) q.classList.toggle('dm-on', q.dataset.corner === corner);
  const dot = menu.querySelector('.dm-here');
  if (dot && !corner && here) {
    dot.hidden = false;
    dot.style.left = Math.max(8, Math.min(92, here.x * 100)) + '%';
    dot.style.top = Math.max(14, Math.min(72, here.y * 100)) + '%';   // above the taskbar strip
  }
  const r = menu.getBoundingClientRect();
  window.menuBridge.size(Math.ceil(r.width) + MARGIN * 2, Math.ceil(r.height) + MARGIN * 2);
});

document.addEventListener('click', e => {
  const item = e.target.closest('[data-k]');
  if (item) window.menuBridge.pick(item.dataset.k);
  else if (!e.target.closest('#doubao-mods-avatar-menu')) window.menuBridge.close();   // the shadow margin
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.menuBridge.close(); });
document.addEventListener('contextmenu', e => e.preventDefault());
