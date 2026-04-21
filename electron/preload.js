// Preload script — exposes a minimal, safe API to the renderer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelf', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('shelf:pick-folder'),
  showNotification: (title, body) => ipcRenderer.invoke('shelf:notification', { title, body }),
  setProgress: (fraction) => ipcRenderer.invoke('shelf:progress', fraction),
  trashFiles: (paths) => ipcRenderer.invoke('shelf:trash-files', paths),
});
