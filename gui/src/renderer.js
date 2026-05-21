const elements = {
  deviceLine: document.getElementById('deviceLine'),
  documentationButton: document.getElementById('documentationButton'),
  rebootButton: document.getElementById('rebootButton'),
  flashTab: document.getElementById('flashTab'),
  parametersTab: document.getElementById('parametersTab'),
  flashView: document.getElementById('flashView'),
  parametersView: document.getElementById('parametersView'),
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
  log: document.getElementById('log'),
  parameterReleaseApi: document.getElementById('parameterReleaseApi'),
  parameterLoaderSource: document.getElementById('parameterLoaderSource'),
  parameterImageSource: document.getElementById('parameterImageSource'),
  configEditor: document.getElementById('configEditor'),
  loadConfigButton: document.getElementById('loadConfigButton'),
  exportConfigButton: document.getElementById('exportConfigButton'),
  resetConfigButton: document.getElementById('resetConfigButton'),
  applyConfigButton: document.getElementById('applyConfigButton')
};
elements.configBanner = document.getElementById('configBanner');
elements.configBannerText = document.getElementById('configBannerText');

let busy = false;
let flashBusy = false;
let rebootAvailable = false;
let rebootInFlight = false;
let firmwareUpdateActive = false;
let firmwareUpdateFinished = false;
let firmwareProgressFloor = 0;
let currentPublicConfig = null;

function updateDeviceLine(device) {
  elements.deviceLine.textContent = `Vid=0x${device.vid}, Pid=0x${device.pid}, LocationID=${device.locationId}, ${device.mode}`;
}

function selectedRadio(name) {
  const radio = document.querySelector(`input[name="${name}"]:checked`);
  return radio ? radio.value : 'online';
}

function switchView(viewName) {
  const tabs = [elements.flashTab, elements.parametersTab];
  const views = [elements.flashView, elements.parametersView];

  for (const tab of tabs) {
    const selected = tab.dataset.view === viewName;
    tab.classList.toggle('active', selected);
    if (selected) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  }

  for (const view of views) {
    view.hidden = view.dataset.viewPanel !== viewName;
    view.classList.toggle('active', !view.hidden);
  }
}

function updateRebootButton() {
  elements.rebootButton.disabled = flashBusy || rebootInFlight || !rebootAvailable;
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) {
    button.disabled = value;
  }
  updateRebootButton();
  updateSourceControls();
}

function setFlashBusy(value) {
  flashBusy = value;
  updateRebootButton();
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

function renderConfigurationState(state) {
  currentPublicConfig = state.config;
  const selectedLoaderChoice = elements.loaderChoice.value;
  elements.loaderChoice.textContent = '';
  for (const choice of state.config.loader.choices || []) {
    const option = document.createElement('option');
    option.value = choice.id;
    option.textContent = choice.label;
    option.dataset.url = choice.url;
    elements.loaderChoice.appendChild(option);
  }
  if (selectedLoaderChoice && [...elements.loaderChoice.options].some((option) => option.value === selectedLoaderChoice)) {
    elements.loaderChoice.value = selectedLoaderChoice;
  }

  elements.loaderUrl.textContent = elements.loaderChoice.selectedOptions[0]?.dataset.url || state.config.loader.url;
  elements.imageUrl.textContent = state.config.image.url;
  elements.parameterReleaseApi.textContent = state.configInfo?.source?.releaseApiHost || 'Not configured';
  elements.parameterLoaderSource.textContent = state.configInfo?.source?.loaderHost || 'Not configured';
  elements.parameterImageSource.textContent = state.configInfo?.source?.imageHost || 'Not configured';

  if (state.configInfo?.overrides?.length > 0) {
    elements.configBanner.hidden = false;
    elements.configBannerText.textContent = [
      `Config: ${state.configInfo.overrides.join(', ')}`,
      `Release API: ${state.configInfo.source.releaseApiHost || 'not configured'}`,
      `Maskrom loader: ${state.configInfo.source.loaderHost || 'not configured'}`,
      `Image: ${state.configInfo.source.imageHost || 'not configured'}`
    ].join(' | ');
  } else {
    elements.configBanner.hidden = true;
    elements.configBannerText.textContent = '';
  }

  updateSourceControls();
}

function appendLog(line) {
  elements.log.textContent += `${line}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setStatus(message, mode = '') {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-pill ${mode}`.trim();
}

function setProgress(label, value, options = {}) {
  let normalized = Math.max(0, Math.min(100, Number(value) || 0));
  if (!options.allowRegression) {
    if (firmwareUpdateFinished && normalized < 100) return;
    if (firmwareUpdateActive && normalized < firmwareProgressFloor) {
      normalized = firmwareProgressFloor;
    }
  }
  if (firmwareUpdateActive || firmwareUpdateFinished) {
    firmwareProgressFloor = Math.max(firmwareProgressFloor, normalized);
  }
  elements.progressLabel.textContent = label;
  elements.progressValue.textContent = `${normalized}%`;
  elements.progressBar.value = normalized;
}

function startFirmwareProgress() {
  firmwareUpdateActive = true;
  firmwareUpdateFinished = false;
  firmwareProgressFloor = 0;
  setProgress('Preparing', 0, { allowRegression: true });
}

function finishFirmwareProgress() {
  firmwareUpdateActive = false;
  firmwareUpdateFinished = true;
  firmwareProgressFloor = 100;
  setProgress('Done', 100);
}

function failFirmwareProgress() {
  firmwareUpdateActive = false;
  firmwareUpdateFinished = false;
}

function cleanErrorMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '');
}

function waitForUiPaint() {
  return new Promise((resolve) => {
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 0);
    raf(() => raf(resolve));
  });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function progressIsComplete() {
  return Number(elements.progressBar.value) >= 100;
}

function operationIsIdle(state) {
  return Boolean(state)
    && !state.busy
    && !state.downloadBusy
    && !state.flashBusy
    && !state.toolBusy;
}

async function waitForRebootProposalReady({ timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = await window.rkGui.getOperationState();
    if (progressIsComplete() && operationIsIdle(state)) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
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
    appendLog(cleanErrorMessage(error));
    return;
  }
  if (!confirmed) {
    appendLog('Update canceled.');
    setStatus('Canceled');
    return;
  }

  setStatus('Updating...');
  startFirmwareProgress();
  try {
    await window.rkGui.startUpdate(options);
    finishFirmwareProgress();
    setStatus('Done', 'ok');
    rebootAvailable = true;
    updateRebootButton();
    await waitForUiPaint();
    const rebootReady = await waitForRebootProposalReady();
    if (!rebootReady) {
      appendLog('Reboot proposal skipped: progress is not complete or an operation is still running.');
      return;
    }
    await waitForUiPaint();
    await performReboot({ confirmFirst: true });
  } catch (error) {
    failFirmwareProgress();
    setStatus('Error', 'error');
    setProgress('Failed', elements.progressBar.value);
    appendLog(cleanErrorMessage(error));
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
        setStatus('Rebooted', 'ok');
        await window.rkGui.showRebootSuccess();
        return;
      } catch (error) {
        setStatus('Error', 'error');
        appendLog(cleanErrorMessage(error));
        const choice = await window.rkGui.confirmRebootFailure(cleanErrorMessage(error));
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
  if (event.type === 'flash-busy') setFlashBusy(event.value);
  if (event.type === 'device') {
    updateDeviceLine(event.device);
    rebootAvailable = true;
    updateRebootButton();
    if (event.simulation) {
      setStatus('Simulation');
    }
  }
  if (event.type === 'done') {
    appendLog(event.message);
    setStatus('Done', 'ok');
    finishFirmwareProgress();
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

elements.flashTab.addEventListener('click', () => switchView('flash'));
elements.parametersTab.addEventListener('click', () => switchView('parameters'));

elements.documentationButton.addEventListener('click', async () => {
  try {
    await window.rkGui.openDocumentation();
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(cleanErrorMessage(error));
  }
});

elements.loadConfigButton.addEventListener('click', async () => {
  try {
    const result = await window.rkGui.loadExternalConfigFile();
    if (result.canceled) return;
    elements.configEditor.value = result.json;
    setStatus('Configuration loaded');
    appendLog(`Configuration loaded from ${result.filePath}. Click Apply to save and use it.`);
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(cleanErrorMessage(error));
  }
});

elements.exportConfigButton.addEventListener('click', async () => {
  try {
    const result = await window.rkGui.exportConfigFile(elements.configEditor.value);
    if (result.canceled) return;
    setStatus('Configuration exported', 'ok');
    appendLog(`Configuration exported to ${result.filePath}.`);
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(cleanErrorMessage(error));
  }
});

elements.resetConfigButton.addEventListener('click', async () => {
  try {
    const result = await window.rkGui.resetConfig();
    if (result.canceled) return;
    elements.configEditor.value = result.json;
    renderConfigurationState(result);
    setStatus('Defaults restored', 'ok');
    appendLog(`Configuration reset to defaults and saved to ${result.filePath}.`);
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(cleanErrorMessage(error));
  }
});

elements.applyConfigButton.addEventListener('click', async () => {
  try {
    const result = await window.rkGui.applyConfig(elements.configEditor.value);
    elements.configEditor.value = result.json;
    renderConfigurationState(result);
    setStatus('Configuration applied', 'ok');
    appendLog(`Configuration applied and saved to ${result.filePath}.`);
  } catch (error) {
    setStatus('Error', 'error');
    appendLog(cleanErrorMessage(error));
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const state = await window.rkGui.getInitialState();
  const device = state.device;
  updateDeviceLine(device);
  rebootAvailable = true;
  updateRebootButton();
  if (state.simulation) {
    setStatus('Simulation');
  }
  elements.loaderChoice.addEventListener('change', () => {
    elements.loaderUrl.textContent = elements.loaderChoice.selectedOptions[0]?.dataset.url || currentPublicConfig?.loader?.url || '';
  });
  renderConfigurationState(state);
  elements.configEditor.value = await window.rkGui.getConfigJson();
});
