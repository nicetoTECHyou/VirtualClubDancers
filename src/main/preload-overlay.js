const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vcdOverlay', {
  onCommand: (callback) => ipcRenderer.on('overlay-command', (event, data) => callback(data)),
  sendUpdate: (data) => ipcRenderer.send('avatar-update', data),
  loadAnimations: () => ipcRenderer.invoke('load-animations')
});
