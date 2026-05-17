async function createMainWindow({ BrowserWindow, preloadPath, indexPath }) {
  const window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 620,
    show: false,
    title: 'RK Firmware Updater',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once('ready-to-show', () => window.show());
  await window.loadFile(indexPath);
  if (!window.isVisible()) {
    window.show();
  }

  return window;
}

module.exports = {
  createMainWindow
};
