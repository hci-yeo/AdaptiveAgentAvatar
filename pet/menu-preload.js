// The only things the pet's menu window can ask of the pet's main process. Runs sandboxed (no Node).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuBridge', {
  // { html, css, corner, here }: the menu to show (built by the pet's page), which screen corner she
  // stands in (or null) and where she is on the screen (fractions), for the "Where she stands" picture.
  onShow: cb => ipcRenderer.on('menu:show', (e, m) => cb(m)),
  // The menu's size once drawn, so the window fits it.
  size: (w, h) => ipcRenderer.send('menu:size', { w: Number(w) || 0, h: Number(h) || 0 }),
  // An item was clicked (its data-k number), or the menu should close (Esc).
  pick: k => ipcRenderer.send('menu:pick', Number(k)),
  close: () => ipcRenderer.send('menu:close'),
});
