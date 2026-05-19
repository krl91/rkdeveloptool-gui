const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findChecksumAsset,
  findMatchingAsset,
  findRkdeveloptoolWithDiagnostics,
  githubApiFromReleasePage,
  describeUpdatePlan,
  isNoDeviceOutput,
  isSafeExternalUrl,
  loadConfigFilesWithSources,
  normalizeLocalPath,
  normalizeFileKind,
  normalizeTimeoutMs,
  normalizeUpdateOptions,
  parseDevices,
  plannedUpdateKinds,
  publicConfig,
  resolveSha256FromRelease,
  simulatedDevice,
  sha256File,
  shouldHashLocalFile,
  sourceSummary,
  validateLocalPathSelection
} = require('./lib');
const { createSimulationRunner } = require('./simulationRunner');
const { createToolRunner } = require('./toolRunner');
const { createMainWindow: createBrowserMainWindow } = require('./windowFactory');

let mainWindow = null;
let appState = {
  config: null,
  configOverrides: [],
  device: null,
  rkdeveloptoolPath: null,
  rkdeveloptoolSearchPaths: [],
  simulation: false,
  busy: false,
  allowedLocalPaths: new Set()
};
let quitWarningOpen = false;

function loadConfig() {
  const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.json');
  const candidates = [
    process.env.RKDEVELOPTOOL_GUI_CONFIG,
    path.join(process.cwd(), 'rkdeveloptool-gui.config.json'),
    path.join(app.getPath('userData'), 'rkdeveloptool-gui.config.json'),
    path.join(process.resourcesPath || '', 'rkdeveloptool-gui.config.json')
  ].filter(Boolean);
  return loadConfigFilesWithSources(defaultConfigPath, candidates);
}

function findRkdeveloptool(config) {
  return findRkdeveloptoolWithDiagnostics(config, {
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
    searchPaths: appState.rkdeveloptoolSearchPaths,
    emit
  });
  return runner(args, options);
}

function timeoutSignal(timeoutMs) {
  if (!timeoutMs) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeout = timeoutSignal(options.timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'rkdeveloptool-gui' },
      signal: timeout?.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Network request timed out after ${options.timeoutMs} ms: ${url}`);
    }
    throw error;
  } finally {
    timeout?.clear();
  }
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
  const timeoutMs = normalizeTimeoutMs(appState.config?.network?.metadataTimeoutMs, 300000);
  const response = await fetchWithTimeout(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status})`);
  }
  return response.json();
}

async function fetchText(url) {
  const timeoutMs = normalizeTimeoutMs(appState.config?.network?.metadataTimeoutMs, 300000);
  const response = await fetchWithTimeout(url, { timeoutMs });
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
  emit('log', { line: `Download source ${asset.name}: ${asset.url}` });
  const timeoutMs = normalizeTimeoutMs(appState.config?.network?.downloadTimeoutMs, 7200000);
  const response = await fetchWithTimeout(asset.url, { timeoutMs });
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
    await cleanupTempDownload(writer, tempDestination);
    throw error;
  }
}

async function cleanupTempDownload(writer, tempDestination) {
  if (!writer.destroyed && !writer.closed) {
    await new Promise((resolve) => {
      writer.once('close', resolve);
      writer.destroy();
    });
  }
  try {
    fs.rmSync(tempDestination, { force: true });
  } catch {
    // Best-effort cleanup; Windows may keep a recently destroyed file busy.
  }
}

async function prepareFile(kind, source, localPath) {
  if (source === 'online') {
    const asset = await resolveOnlineAsset(kind);
    return downloadAndVerify(asset);
  }
  validateLocalPathSelection(kind, localPath, appState.allowedLocalPaths);
  if (!shouldHashLocalFile({ simulation: appState.simulation })) {
    emit('log', { line: `Simulation: skipping local SHA256 for ${path.basename(localPath)}.` });
    return localPath;
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

    for (const [index, kind] of plan.entries()) {
      const progressOptions = {
        progressLabel: `${kind === 'loader' ? 'Loader' : 'Image'} ${index + 1}/${plan.length}`,
        progressOffset: (index / plan.length) * 100,
        progressScale: 1 / plan.length
      };

      if (kind === 'loader') {
        const loaderPath = await prepareFile('loader', options.loaderSource, options.loaderPath);
        emit('status', { message: 'Writing loader...' });
        await runTool(['db', loaderPath], progressOptions);
      }

      if (kind === 'image') {
        const imagePath = await prepareFile('image', options.imageSource, options.imagePath);
        emit('status', { message: 'Writing image...' });
        await runTool(['wl', String(appState.config.image.lba ?? 0), imagePath], progressOptions);
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
    indexPath: path.join(__dirname, 'index.html'),
    shouldBlockClose: () => appState.busy,
    onBlockedClose: warnOperationInProgress
  });
}

ipcMain.handle('app:getInitialState', () => ({
  device: appState.device,
  config: publicConfig(appState.config),
  configInfo: {
    overrides: appState.configOverrides,
    source: sourceSummary(appState.config)
  },
  platform: os.platform(),
  simulation: appState.simulation
}));

ipcMain.handle('app:openDocumentation', async () => {
  const url = appState.config?.documentationUrl;
  if (!isSafeExternalUrl(url)) {
    throw new Error('No valid documentation URL is configured.');
  }
  await shell.openExternal(url);
  return { ok: true };
});

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
  const filePath = result.filePaths[0];
  appState.allowedLocalPaths.add(normalizeLocalPath(filePath));
  return filePath;
});

ipcMain.handle('app:confirmUpdate', async (_event, options) => {
  const normalizedOptions = normalizeUpdateOptions(options);
  const lines = describeUpdatePlan(normalizedOptions);
  const sources = sourceSummary(appState.config);
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
      `Release API host: ${sources.releaseApiHost || 'not configured'}`,
      `Loader host: ${sources.loaderHost || 'not configured'}`,
      `Image host: ${sources.imageHost || 'not configured'}`,
      appState.configOverrides.length > 0 ? `Custom config loaded from: ${appState.configOverrides.join(', ')}` : 'Using packaged default configuration.',
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
    const loadedConfig = loadConfig();
    appState.config = loadedConfig.config;
    appState.configOverrides = loadedConfig.overrides;
    const tool = findRkdeveloptool(appState.config);
    appState.rkdeveloptoolPath = tool.path;
    appState.rkdeveloptoolSearchPaths = tool.searchPaths;
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
      announceConfigSources();
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
    announceConfigSources();
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

function announceConfigSources() {
  const sources = sourceSummary(appState.config);
  if (appState.configOverrides.length > 0) {
    emit('log', { line: `Custom config loaded from: ${appState.configOverrides.join(', ')}` });
  }
  emit('log', { line: `Release API host: ${sources.releaseApiHost || 'not configured'}` });
  emit('log', { line: `Loader host: ${sources.loaderHost || 'not configured'}` });
  emit('log', { line: `Image host: ${sources.imageHost || 'not configured'}` });
}

async function warnOperationInProgress() {
  if (quitWarningOpen) return;
  quitWarningOpen = true;
  const options = {
    type: 'warning',
    buttons: ['OK'],
    title: 'Operation in progress',
    message: 'A flash operation is running.',
    detail: 'Closing now could interrupt the flash operation. Wait until the operation completes.'
  };
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, options);
      return;
    }
    await dialog.showMessageBox(options);
  } finally {
    quitWarningOpen = false;
  }
}

app.on('before-quit', (event) => {
  if (appState.busy) {
    event.preventDefault();
    warnOperationInProgress();
  }
});

app.on('window-all-closed', () => {
  if (appState.busy) {
    warnOperationInProgress();
    return;
  }
  app.quit();
});
