const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rkGui', {
  getInitialState: () => ipcRenderer.invoke('app:getInitialState'),
  chooseFile: (kind) => ipcRenderer.invoke('app:chooseFile', kind),
  confirmUpdate: (options) => ipcRenderer.invoke('app:confirmUpdate', options),
  confirmReboot: () => ipcRenderer.invoke('app:confirmReboot'),
  confirmRebootFailure: (message) => ipcRenderer.invoke('app:confirmRebootFailure', message),
  showRebootSuccess: () => ipcRenderer.invoke('app:showRebootSuccess'),
  startUpdate: (options) => ipcRenderer.invoke('app:startUpdate', options),
  reboot: () => ipcRenderer.invoke('app:reboot'),
  forceClose: () => ipcRenderer.invoke('app:forceClose'),
  openDocumentation: () => ipcRenderer.invoke('app:openDocumentation'),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  }
});
