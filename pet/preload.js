// The only things the pet page can ask of the pet's main process. Runs sandboxed (no Node), and the
// page gets just these functions, not Electron itself.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // Whether the cursor is on her (the rest of the window lets clicks through).
  hit: on => ipcRenderer.send('pet:hit', !!on),
  // Dragging her moves the whole window: 'start' / 'end'.
  drag: phase => ipcRenderer.send('pet:drag', phase === 'start' ? 'start' : 'end'),
  // Right-click menu: the page builds it (the same menu as in the app) and the pet program shows it
  // in its own small menu window. { html, css }; clicks come back as onCommand({ type: 'menu', k }).
  menu: m => ipcRenderer.send('pet:menu', { html: String(m?.html || ''), css: String(m?.css || '') }),
  // Menu choices the pet program or the app carries out: 'look' (style), 'ring' (rainbow chat box),
  // 'back' (pet mode off), 'corner' (move to a screen corner).
  act: (type, value) => ipcRenderer.send('pet:act', { type: String(type), value }),
  ready: () => ipcRenderer.send('pet:ready'),
  // From the watcher: { outfit, phase, app }.
  onState: cb => ipcRenderer.on('pet:state', (e, s) => cb(s)),
  // From the menu window: { type: 'menu', k } (which item was clicked).
  onCommand: cb => ipcRenderer.on('pet:command', (e, c) => cb(c)),
  // Cursor position inside the window, so the page can say whether it's on her.
  onPointer: cb => ipcRenderer.on('pet:pointer', (e, p) => cb(p)),
});
