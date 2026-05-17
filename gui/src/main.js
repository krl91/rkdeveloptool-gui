const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findChecksumAsset,
  findMatchingAsset,
  findRkdeveloptool: findBundledRkdeveloptool,
  githubApiFromReleasePage,
  describeUpdatePlan,
  isNoDeviceOutput,
  loadConfigFiles,
  normalizeFileKind,
  normalizeUpdateOptions,
  parseDevices,
  plannedUpdateKinds,
  resolveSha256FromRelease,
  simulatedDevice,
  sha256File
} = require('./lib');
const { createSimulationRunner } = require('./simulationRunner');
const { createToolRunner } = require('./toolRunner');
const { createMainWindow: createBrowserMainWindow } = require('./windowFactory');

let mainWindow = null;
let appState = {
  config: null,
  device: null,
  rkdeveloptoolPath: null,
  simulation: false,
  busy: false
};

function loadConfig() {
  const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.json');
  const candidates = [
    process.env.RKDEVELOPTOOL_GUI_CONFIG,
    path.join(process.cwd(), 'rkdeveloptool-gui.config.json'),
    path.join(app.getPath('userData'), 'rkdeveloptool-gui.config.json'),
    path.join(process.resourcesPath || '', 'rkdeveloptool-gui.config.json')
  ].filter(Boolean);
  return loadConfigFiles(defaultConfigPath, candidates);
}

function findRkdeveloptool(config) {
  return findBundledRkdeveloptool(config, {
    resourcesPath: process.resourcesPath,
    guiRoot: path.join(__dirname, '..'),
    repoRoot: path.join(__dirname, '..', '..'),
    cwd: process.cwd()
  });
}

function emit(type, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:event', { type, ...payload });
  }
}

function runTool(args, options = {}) {
  if (appState.simulation) {
    return createSimulationRunner({ emit })(args, options);
  }
  const runner = createToolRunner({
    toolPath: appState.rkdeveloptoolPath,
    config: appState.config,
    emit
  });
  return runner(args, options);
}

async function detectSingleDevice() {
  try {
    const result = await runTool(['ld']);
    return parseDevices(result.stdout);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    if (isNoDeviceOutput(output)) {
      return [];
    }
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'rkdeveloptool-gui' } });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status})`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'rkdeveloptool-gui' } });
  if (!response.ok) {
    throw new Error(`Checksum download failed (${response.status})`);
  }
  return response.text();
}

async function resolveOnlineAsset(kind) {
  const item = appState.config[kind];
  const releaseApiUrl = appState.config.releaseApiUrl || githubApiFromReleasePage(appState.config.releasePageUrl);
  if (!releaseApiUrl) {
    throw new Error('No GitHub release API URL is configured.');
  }

  emit('status', { message: `Looking up ${kind} SHA256...` });
  const release = await fetchJson(releaseApiUrl);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = findMatchingAsset(assets, item);

  if (!asset) {
    throw new Error(`Asset not found in release: ${item.assetName}`);
  }

  const directSha256 = resolveSha256FromRelease(release, asset);
  let checksumText = '';
  if (!directSha256) {
    const checksumAsset = findChecksumAsset(assets);
    if (checksumAsset?.browser_download_url) {
      checksumText = await fetchText(checksumAsset.browser_download_url);
    }
  }
  const sha256 = directSha256 || resolveSha256FromRelease(release, asset, checksumText);

  if (!sha256) {
    throw new Error(`SHA256 not found for ${asset.name}. Configure a manifest or checksum asset in the release.`);
  }

  return {
    name: asset.name,
    url: asset.browser_download_url || item.url,
    sha256
  };
}

async function downloadAndVerify(asset) {
  const downloadDir = path.join(app.getPath('userData'), 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const assetName = path.basename(asset.name);
  if (!assetName || assetName !== asset.name) {
    throw new Error(`Unsafe asset name: ${asset.name}`);
  }
  const destination = path.join(downloadDir, assetName);
  const tempDestination = `${destination}.download`;
  const hash = crypto.createHash('sha256');

  emit('status', { message: `Downloading ${asset.name}...` });
  const response = await fetch(asset.url, { headers: { 'User-Agent': 'rkdeveloptool-gui' } });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }

  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;
  const writer = fs.createWriteStream(tempDestination);
  const reader = response.body.getReader();

  try {
    await new Promise((resolve, reject) => {
      writer.once('error', reject);
      writer.once('open', resolve);
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.byteLength;
      hash.update(chunk);
      if (!writer.write(chunk)) {
        await new Promise((resolve, reject) => {
          writer.once('drain', resolve);
          writer.once('error', reject);
        });
      }
      if (total > 0) {
        emit('progress', { label: `Downloading ${asset.name}`, value: Math.floor((received / total) * 100) });
      }
    }

    await new Promise((resolve, reject) => writer.end((error) => error ? reject(error) : resolve()));
    const actual = hash.digest('hex');
    if (actual !== asset.sha256) {
      fs.rmSync(tempDestination, { force: true });
      throw new Error(`Invalid SHA256 for ${asset.name}: ${actual}`);
    }
    fs.renameSync(tempDestination, destination);
    emit('log', { line: `SHA256 OK ${asset.name}: ${actual}` });
    return destination;
  } catch (error) {
    writer.destroy();
    fs.rmSync(tempDestination, { force: true });
    throw error;
  }
}

async function prepareFile(kind, source, localPath) {
  if (source === 'online') {
    const asset = await resolveOnlineAsset(kind);
    return downloadAndVerify(asset);
  }
  if (!localPath) {
    throw new Error(`No local file selected for ${kind}.`);
  }
  const digest = await sha256File(localPath);
  emit('log', { line: `Local SHA256 ${path.basename(localPath)}: ${digest}` });
  return localPath;
}

async function runUpdate(options) {
  if (appState.busy) {
    throw new Error('An update is already running.');
  }
  appState.busy = true;
  emit('busy', { value: true });
  emit('progress', { label: 'Preparing', value: 0 });

  try {
    const plan = plannedUpdateKinds(options);

    for (const kind of plan) {
      if (kind === 'loader') {
        const loaderPath = await prepareFile('loader', options.loaderSource, options.loaderPath);
        emit('status', { message: 'Writing loader...' });
        await runTool(['db', loaderPath], { progressLabel: 'Loader' });
      }

      if (kind === 'image') {
        const imagePath = await prepareFile('image', options.imageSource, options.imagePath);
        emit('status', { message: 'Writing image...' });
        await runTool(['wl', String(appState.config.image.lba ?? 0), imagePath], { progressLabel: 'Image' });
      }
    }

    emit('progress', { label: 'Done', value: 100 });
    emit('done', { message: 'Update completed.' });
    return { ok: true };
  } finally {
    appState.busy = false;
    emit('busy', { value: false });
  }
}

async function createMainWindow() {
  mainWindow = await createBrowserMainWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    indexPath: path.join(__dirname, 'index.html')
  });
}

ipcMain.handle('app:getInitialState', () => ({
  device: appState.device,
  config: appState.config,
  platform: os.platform(),
  simulation: appState.simulation
}));

ipcMain.handle('app:chooseFile', async (_event, kind) => {
  const normalizedKind = normalizeFileKind(kind);
  const filters = normalizedKind === 'loader'
    ? [{ name: 'Loader', extensions: ['bin'] }, { name: 'All files', extensions: ['*'] }]
    : [{ name: 'Images', extensions: ['img', 'bin'] }, { name: 'All files', extensions: ['*'] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters
  });
  if (result.canceled || result.filePaths.length === 0) return '';
  return result.filePaths[0];
});

ipcMain.handle('app:confirmUpdate', async (_event, options) => {
  const normalizedOptions = normalizeUpdateOptions(options);
  const lines = describeUpdatePlan(normalizedOptions);
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Start', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm update',
    message: 'Confirm the operations to run.',
    detail: [
      ...lines,
      '',
      'The loader is always updated before the image.',
      appState.simulation ? 'Simulation mode: no real device will be flashed.' : 'Do not disconnect the device during the operation.'
    ].join('\n')
  });
  return result.response === 0;
});

ipcMain.handle('app:startUpdate', (_event, options) => runUpdate(normalizeUpdateOptions(options)));

ipcMain.handle('app:confirmReboot', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Reboot now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Reboot device',
    message: 'The update is complete.',
    detail: appState.simulation
      ? 'Simulation mode: the reboot will be simulated.'
      : 'Do you want to reboot the device now?'
  });
  return result.response === 0;
});

ipcMain.handle('app:reboot', async () => {
  if (appState.busy) {
    throw new Error('Cannot reboot while an update is running.');
  }
  appState.busy = true;
  emit('busy', { value: true });
  try {
    await runTool(['rd']);
    emit('done', { message: 'Reboot command sent.' });
    return { ok: true };
  } finally {
    appState.busy = false;
    emit('busy', { value: false });
  }
});

app.whenReady().then(async () => {
  try {
    appState.config = loadConfig();
    appState.rkdeveloptoolPath = findRkdeveloptool(appState.config);
    const devices = await detectSingleDevice();
    if (devices.length === 0) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Simulate a device', 'Close'],
        defaultId: 0,
        cancelId: 1,
        title: 'No device',
        message: 'No Rockusb device was detected.',
        detail: 'You can simulate a device to open the interface without flashing real hardware, or close the application.'
      });
      if (result.response === 1) {
        app.quit();
        return;
      }
      appState.device = simulatedDevice();
      appState.simulation = true;
      await createMainWindow();
      emit('log', { line: 'Simulation mode: no real device will be flashed.' });
      return;
    }
    if (devices.length > 1) {
      await dialog.showMessageBox({
        type: 'warning',
        buttons: ['OK'],
        title: 'Multiple devices',
        message: 'Multiple Rockusb devices were detected. Keep only one device connected, then restart the application.'
      });
      app.quit();
      return;
    }
    appState.device = devices[0];
    appState.simulation = false;
    await createMainWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['OK'],
      title: 'Startup error',
      message: error.message
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
