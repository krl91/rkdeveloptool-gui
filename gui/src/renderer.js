const elements = {
  deviceLine: document.getElementById('deviceLine'),
  rebootButton: document.getElementById('rebootButton'),
  quickUpdateButton: document.getElementById('quickUpdateButton'),
  updateLoader: document.getElementById('updateLoader'),
  updateImage: document.getElementById('updateImage'),
  loaderPath: document.getElementById('loaderPath'),
  imagePath: document.getElementById('imagePath'),
  chooseLoader: document.getElementById('chooseLoader'),
  chooseImage: document.getElementById('chooseImage'),
  loaderUrl: document.getElementById('loaderUrl'),
  imageUrl: document.getElementById('imageUrl'),
  startButton: document.getElementById('startButton'),
  progressLabel: document.getElementById('progressLabel'),
  progressValue: document.getElementById('progressValue'),
  progressBar: document.getElementById('progressBar'),
  statusText: document.getElementById('statusText'),
  log: document.getElementById('log')
};

let busy = false;

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) {
    button.disabled = value;
  }
  elements.rebootButton.disabled = value;
  updateSourceControls();
}

function updateSourceControls() {
  const loaderLocal = selectedRadio('loaderSource') === 'local';
  const imageLocal = selectedRadio('imageSource') === 'local';
  elements.chooseLoader.disabled = busy || !loaderLocal;
  elements.loaderPath.disabled = !loaderLocal;
  elements.chooseImage.disabled = busy || !imageLocal;
  elements.imagePath.disabled = !imageLocal;
}

function appendLog(line) {
  elements.log.textContent += `${line}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setStatus(message, mode = '') {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-pill ${mode}`.trim();
}

function setProgress(label, value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  elements.progressLabel.textContent = label;
  elements.progressValue.textContent = `${normalized}%`;
  elements.progressBar.value = normalized;
}

function collectOptions() {
  return {
    updateLoader: elements.updateLoader.checked,
    updateImage: elements.updateImage.checked,
    loaderSource: selectedRadio('loaderSource'),
    imageSource: selectedRadio('imageSource'),
    loaderPath: elements.loaderPath.value,
    imagePath: elements.imagePath.value
  };
}

async function runUpdate(options) {
  let confirmed = false;
  try {
    confirmed = await window.rkGui.confirmUpdate(options);
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
    return;
  }
  if (!confirmed) {
    appendLog('Update canceled.');
    setStatus('Canceled');
    return;
  }

  setStatus('Updating...');
  setProgress('Preparing', 0);
  try {
    await window.rkGui.startUpdate(options);
    setStatus('Done', 'ok');
    elements.rebootButton.disabled = false;
    await proposeReboot();
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
  }
}

async function proposeReboot() {
  try {
    const confirmed = await window.rkGui.confirmReboot();
    if (!confirmed) return;
    setStatus('Rebooting...');
    await window.rkGui.reboot();
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
  }
}

window.rkGui.onEvent((event) => {
  if (event.type === 'log') appendLog(event.line);
  if (event.type === 'status') setStatus(event.message);
  if (event.type === 'progress') setProgress(event.label, event.value);
  if (event.type === 'busy') setBusy(event.value);
  if (event.type === 'done') {
    appendLog(event.message);
    setStatus('Done', 'ok');
    elements.rebootButton.disabled = false;
  }
});

for (const input of document.querySelectorAll('input[type="radio"]')) {
  input.addEventListener('change', updateSourceControls);
}

elements.chooseLoader.addEventListener('click', async () => {
  const filePath = await window.rkGui.chooseFile('loader');
  if (filePath) elements.loaderPath.value = filePath;
});

elements.chooseImage.addEventListener('click', async () => {
  const filePath = await window.rkGui.chooseFile('image');
  if (filePath) elements.imagePath.value = filePath;
});

elements.startButton.addEventListener('click', () => runUpdate(collectOptions()));

elements.quickUpdateButton.addEventListener('click', () => {
  elements.updateLoader.checked = true;
  elements.updateImage.checked = true;
  document.querySelector('input[name="loaderSource"][value="online"]').checked = true;
  document.querySelector('input[name="imageSource"][value="online"]').checked = true;
  updateSourceControls();
  runUpdate(collectOptions());
});

elements.rebootButton.addEventListener('click', async () => {
  setStatus('Rebooting...');
  try {
    await window.rkGui.reboot();
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const state = await window.rkGui.getInitialState();
  const device = state.device;
  elements.deviceLine.textContent = `Vid=0x${device.vid}, Pid=0x${device.pid}, LocationID=${device.locationId}, ${device.mode}`;
  if (state.simulation) {
    setStatus('Simulation');
  }
  elements.loaderUrl.textContent = state.config.loader.url;
  elements.imageUrl.textContent = state.config.image.url;
  updateSourceControls();
});
