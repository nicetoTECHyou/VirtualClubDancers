const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vcdAdmin', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  connectTwitch: (channel, oauthToken, botUsername) =>
    ipcRenderer.invoke('connect-twitch', channel, oauthToken, botUsername),
  disconnectTwitch: () => ipcRenderer.invoke('disconnect-twitch'),
  getAvatarList: () => ipcRenderer.invoke('get-avatar-list'),
  getEmoteList: () => ipcRenderer.invoke('get-emote-list')
});
