const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rkGui', {
  getInitialState: () => ipcRenderer.invoke('app:getInitialState'),
  getOperationState: () => ipcRenderer.invoke('app:getOperationState'),
  detectDevice: () => ipcRenderer.invoke('app:detectDevice'),
  chooseFile: (kind) => ipcRenderer.invoke('app:chooseFile', kind),
  confirmUpdate: (options) => ipcRenderer.invoke('app:confirmUpdate', options),
  confirmReboot: () => ipcRenderer.invoke('app:confirmReboot'),
  confirmRebootFailure: (message) => ipcRenderer.invoke('app:confirmRebootFailure', message),
  showRebootSuccess: () => ipcRenderer.invoke('app:showRebootSuccess'),
  startUpdate: (options) => ipcRenderer.invoke('app:startUpdate', options),
  reboot: () => ipcRenderer.invoke('app:reboot'),
  forceClose: () => ipcRenderer.invoke('app:forceClose'),
  openDocumentation: () => ipcRenderer.invoke('app:openDocumentation'),
  getConfigJson: () => ipcRenderer.invoke('app:getConfigJson'),
  loadExternalConfigFile: () => ipcRenderer.invoke('app:loadExternalConfigFile'),
  exportConfigFile: (jsonText) => ipcRenderer.invoke('app:exportConfigFile', jsonText),
  applyConfig: (jsonText) => ipcRenderer.invoke('app:applyConfig', jsonText),
  resetConfig: () => ipcRenderer.invoke('app:resetConfig'),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  }
});
