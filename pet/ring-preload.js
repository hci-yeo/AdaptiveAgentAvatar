// The only thing the rainbow chat box page can do: hear its state from the pet program.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ringBridge', {
  onState: cb => ipcRenderer.on('ring:state', (e, s) => cb(s)),
});
