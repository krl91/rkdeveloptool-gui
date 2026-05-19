const elements = {
  deviceLine: document.getElementById('deviceLine'),
  documentationButton: document.getElementById('documentationButton'),
  rebootButton: document.getElementById('rebootButton'),
  quickUpdateButton: document.getElementById('quickUpdateButton'),
  updateLoader: document.getElementById('updateLoader'),
  updateImage: document.getElementById('updateImage'),
  loaderChoice: document.getElementById('loaderChoice'),
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
elements.configBanner = document.getElementById('configBanner');
elements.configBannerText = document.getElementById('configBannerText');

let busy = false;
let rebootAvailable = false;
let rebootInFlight = false;

function updateDeviceLine(device) {
  elements.deviceLine.textContent = `Vid=0x${device.vid}, Pid=0x${device.pid}, LocationID=${device.locationId}, ${device.mode}`;
}

function selectedRadio(name) {
  const radio = document.querySelector(`input[name="${name}"]:checked`);
  return radio ? radio.value : 'online';
}

function updateRebootButton() {
  elements.rebootButton.disabled = busy || rebootInFlight || !rebootAvailable;
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) {
    button.disabled = value;
  }
  updateRebootButton();
  updateSourceControls();
}

function updateSourceControls() {
  const loaderLocal = selectedRadio('loaderSource') === 'local';
  const imageLocal = selectedRadio('imageSource') === 'local';
  elements.loaderChoice.disabled = busy || loaderLocal;
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
    loaderChoiceId: elements.loaderChoice.value,
    loaderChoiceLabel: elements.loaderChoice.selectedOptions[0]?.textContent || '',
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
    rebootAvailable = true;
    updateRebootButton();
    await performReboot({ confirmFirst: true });
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
  }
}

async function performReboot({ confirmFirst = false } = {}) {
  if (rebootInFlight) return;
  rebootInFlight = true;
  updateRebootButton();
  try {
    if (confirmFirst) {
      const confirmed = await window.rkGui.confirmReboot();
      if (!confirmed) return;
    }

    while (true) {
      try {
        setStatus('Rebooting...');
        await window.rkGui.reboot();
        rebootAvailable = false;
        setStatus('Rebooted', 'ok');
        await window.rkGui.showRebootSuccess();
        return;
      } catch (error) {
        setStatus('Error', 'error');
        appendLog(error.message);
        const choice = await window.rkGui.confirmRebootFailure(error.message);
        if (choice === 'retry') {
          continue;
        }
        if (choice === 'force-close') {
          await window.rkGui.forceClose();
        }
        return;
      }
    }
  } finally {
    rebootInFlight = false;
    updateRebootButton();
  }
}

window.rkGui.onEvent((event) => {
  if (event.type === 'log') appendLog(event.line);
  if (event.type === 'status') setStatus(event.message);
  if (event.type === 'progress') setProgress(event.label, event.value);
  if (event.type === 'busy') setBusy(event.value);
  if (event.type === 'device') {
    updateDeviceLine(event.device);
    if (event.simulation) {
      setStatus('Simulation');
    }
  }
  if (event.type === 'done') {
    appendLog(event.message);
    setStatus('Done', 'ok');
    rebootAvailable = true;
    updateRebootButton();
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
  updateSourceControls();
  runUpdate(collectOptions());
});

elements.rebootButton.addEventListener('click', () => performReboot());

elements.documentationButton.addEventListener('click', async () => {
  try {
    await window.rkGui.openDocumentation();
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(error.message);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const state = await window.rkGui.getInitialState();
  const device = state.device;
  updateDeviceLine(device);
  if (state.simulation) {
    setStatus('Simulation');
  }
  for (const choice of state.config.loader.choices || []) {
    const option = document.createElement('option');
    option.value = choice.id;
    option.textContent = choice.label;
    option.dataset.url = choice.url;
    elements.loaderChoice.appendChild(option);
  }
  elements.loaderUrl.textContent = elements.loaderChoice.selectedOptions[0]?.dataset.url || state.config.loader.url;
  elements.loaderChoice.addEventListener('change', () => {
    elements.loaderUrl.textContent = elements.loaderChoice.selectedOptions[0]?.dataset.url || state.config.loader.url;
  });
  elements.imageUrl.textContent = state.config.image.url;
  if (state.configInfo?.overrides?.length > 0) {
    elements.configBanner.hidden = false;
    elements.configBannerText.textContent = [
      `Config: ${state.configInfo.overrides.join(', ')}`,
      `Release API: ${state.configInfo.source.releaseApiHost || 'not configured'}`,
      `Maskrom loader: ${state.configInfo.source.loaderHost || 'not configured'}`,
      `Image: ${state.configInfo.source.imageHost || 'not configured'}`
    ].join(' | ');
  }
  updateSourceControls();
});
