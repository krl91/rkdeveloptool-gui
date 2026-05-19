const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('simulateButton')?.addEventListener('click', () => {
    ipcRenderer.send('no-device:choice', 'simulate');
  });

  document.getElementById('tryAgainButton')?.addEventListener('click', () => {
    ipcRenderer.send('no-device:choice', 'try-again');
  });

  document.getElementById('closeButton')?.addEventListener('click', () => {
    ipcRenderer.send('no-device:choice', 'close');
  });
});
