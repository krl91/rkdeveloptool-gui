const { app, BrowserWindow, dialog, ipcMain, shell, net } = require('electron');
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
  isSafeExternalUrl,
  loadConfigFilesWithSources,
  normalizeLocalPath,
  normalizeFileKind,
  normalizeTimeoutMs,
  normalizeUpdateOptions,
  mappedPhaseProgress,
  phaseProgressRange,
  plannedUpdateKinds,
  splitProgressForSource,
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
const { createCommandSequencer } = require('./commandDelay');
const {
  detectDevices,
  deviceNeedsLoaderBeforeImage,
  ensureDevicePresentBeforeFlash
} = require('./devicePresence');
const {
  checkForAppUpdate,
  downloadUpdateAsset,
  installUpdate
} = require('./updateManager');
const {
  createMainWindow: createBrowserMainWindow,
  createNoDeviceWindow: createBrowserNoDeviceWindow
} = require('./windowFactory');

let mainWindow = null;
let appState = {
  config: null,
  configOverrides: [],
  device: null,
  rkdeveloptoolPath: null,
  rkdeveloptoolSearchPaths: [],
  simulation: false,
  busy: false,
  flashBusy: false,
  rebooting: false,
  allowedLocalPaths: new Set(),
  windowlessTransition: false
};
let quitWarningOpen = false;
const rkdeveloptoolCommandSequencer = createCommandSequencer({
  getDelayMs: () => normalizeTimeoutMs(appState.config?.rkdeveloptoolCommandDelayMs, 2000)
});

function loadConfig() {
  const candidates = [
    process.env.RKDEVELOPTOOL_GUI_CONFIG,
    path.join(process.cwd(), 'rkdeveloptool-gui.config.json'),
    path.join(app.getPath('userData'), 'rkdeveloptool-gui.config.json'),
    path.join(process.resourcesPath || '', 'rkdeveloptool-gui.config.json')
  ].filter(Boolean);
  return loadConfigFilesWithSources(defaultConfigPath(), candidates);
}

function defaultConfigPath() {
  return path.join(__dirname, '..', 'config', 'default.json');
}

function loadDefaultConfig() {
  return parseEditableConfig(fs.readFileSync(defaultConfigPath(), 'utf8'));
}

function userConfigPath() {
  return path.join(app.getPath('userData'), 'rkdeveloptool-gui.config.json');
}

function parseEditableConfig(jsonText) {
  let config;
  try {
    config = JSON.parse(String(jsonText || ''));
  } catch (error) {
    throw new Error(`Invalid JSON configuration: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid JSON configuration: the root value must be an object.');
  }
  return config;
}

function formatConfigJson(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeUserConfig(config) {
  const destination = userConfigPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tempDestination = `${destination}.tmp`;
  fs.writeFileSync(tempDestination, formatConfigJson(config), 'utf8');
  fs.renameSync(tempDestination, destination);
  return destination;
}

function configStatePayload() {
  return {
    config: publicConfig(appState.config),
    configInfo: {
      overrides: appState.configOverrides,
      source: sourceSummary(appState.config)
    }
  };
}

function applyConfigObject(config) {
  appState.config = config;
  const configPath = writeUserConfig(config);
  appState.configOverrides = Array.from(new Set([...appState.configOverrides, configPath]));
  const tool = findRkdeveloptool(appState.config);
  appState.rkdeveloptoolPath = tool.path;
  appState.rkdeveloptoolSearchPaths = tool.searchPaths;
  return configPath;
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
  return rkdeveloptoolCommandSequencer.run(() => {
    const runner = createToolRunner({
      toolPath: appState.rkdeveloptoolPath,
      config: appState.config,
      searchPaths: appState.rkdeveloptoolSearchPaths,
      emit
    });
    return runner(args, options);
  });
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
  return detectDevices(runTool);
}

function setActiveDevice(device, simulation) {
  appState.device = device;
  appState.simulation = simulation;
  emit('device', { device, simulation });
}

async function ensureDeviceBeforeFlash(kind) {
  if (appState.simulation) {
    return appState.device;
  }

  return ensureDevicePresentBeforeFlash({
    actionLabel: kind === 'loader' ? 'loading Maskrom loader' : 'writing image',
    runTool,
    chooseNoDeviceAction: showNoDeviceChoice,
    setDevice: setActiveDevice,
    emit
  });
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
    const expected = item.assetName || item.url || kind;
    throw new Error(`Online ${kind} asset was not found in the configured release: ${expected}. Check the configuration or select a local file.`);
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
    throw new Error(`Expected SHA256 was not found for ${asset.name}. The application will not flash this online ${kind} without a trusted checksum.`);
  }

  return {
    name: asset.name,
    url: asset.browser_download_url || item.url,
    sha256
  };
}

function configuredLoaderChoice(choiceId) {
  const choices = Array.isArray(appState.config?.loader?.choices) ? appState.config.loader.choices : [];
  return choices.find((choice) => choice.id === choiceId) || null;
}

async function resolveLoaderAsset(options = {}) {
  const choice = configuredLoaderChoice(options.loaderChoiceId);
  if (!choice) {
    return resolveOnlineAsset('loader');
  }
  if (!isSafeExternalUrl(choice.url)) {
    throw new Error(`Invalid loader URL for ${choice.label || choice.id}.`);
  }
  return {
    name: choice.assetName || path.basename(new URL(choice.url).pathname),
    url: choice.url,
    sha256: choice.sha256 || ''
  };
}

async function prepareOnlineLoader(options = {}) {
  return downloadAndVerify(await resolveLoaderAsset(options), options.progressOptions);
}

async function downloadAndVerify(asset, progressOptions) {
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
  if (progressOptions) {
    emitPhaseProgress(progressOptions, 0, `Downloading ${asset.name}`);
  }
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
        if (progressOptions) {
          emitPhaseProgress(progressOptions, Math.floor((received / total) * 100), `Downloading ${asset.name}`);
        } else {
          emit('progress', { label: `Downloading ${asset.name}`, value: Math.floor((received / total) * 100) });
        }
      }
    }

    await new Promise((resolve, reject) => writer.end((error) => error ? reject(error) : resolve()));
    const actual = hash.digest('hex');
    if (asset.sha256 && actual !== asset.sha256) {
      fs.rmSync(tempDestination, { force: true });
      throw new Error(`Invalid SHA256 for ${asset.name}. The download may be incomplete or corrupted.\nExpected: ${asset.sha256}\nActual: ${actual}`);
    }
    fs.renameSync(tempDestination, destination);
    if (asset.sha256) {
      emit('log', { line: `SHA256 OK ${asset.name}: ${actual}` });
    } else {
      emit('log', { line: `SHA256 ${asset.name}: ${actual} (no expected checksum configured)` });
    }
    if (progressOptions) {
      emitPhaseProgress(progressOptions, 100, `Downloaded ${asset.name}`);
    }
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

async function prepareFile(kind, source, localPath, progressOptions) {
  if (source === 'online') {
    const asset = await resolveOnlineAsset(kind);
    return downloadAndVerify(asset, progressOptions);
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

function implicitLoaderOptions(options) {
  return {
    source: options.loaderSource === 'local' && options.loaderPath ? 'local' : 'online',
    path: options.loaderSource === 'local' && options.loaderPath ? options.loaderPath : '',
    loaderChoiceId: options.loaderChoiceId
  };
}

async function prepareLoader(options) {
  if (options.source === 'online') {
    return prepareOnlineLoader(options);
  }
  return prepareFile('loader', 'local', options.path);
}

async function writeLoader(loaderPath, progressOptions, message = 'Loading Maskrom loader...') {
  await ensureDeviceBeforeFlash('loader');
  emit('status', { message });
  appState.flashBusy = true;
  emit('flash-busy', { value: true });
  try {
    await runTool(['db', loaderPath], progressOptions);
  } finally {
    appState.flashBusy = false;
    emit('flash-busy', { value: false });
  }
}

function logMaskromAfterSuccessfulLoader() {
  emit('log', {
    line: 'The device still reports Maskrom after loading the loader; continuing because rkdeveloptool reported the loader was loaded successfully.'
  });
}

function emitPhaseProgress(progressOptions, percent, label = progressOptions.progressLabel) {
  const value = mappedPhaseProgress(progressOptions, percent);
  emit('progress', { label, value });
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
    let loaderLoadedThisRun = false;

    for (const [index, kind] of plan.entries()) {
      const progressOptions = phaseProgressRange(
        index,
        plan.length,
        `${kind === 'loader' ? 'Maskrom loader' : 'Image'} ${index + 1}/${plan.length}`
      );

      emitPhaseProgress(progressOptions, 0);

      if (kind === 'loader') {
        const loaderProgress = splitProgressForSource(progressOptions, options.loaderSource);
        const loaderPath = await prepareLoader({
          source: options.loaderSource,
          path: options.loaderPath,
          loaderChoiceId: options.loaderChoiceId,
          progressOptions: loaderProgress.download
        });
        await writeLoader(loaderPath, loaderProgress.flash);
        emitPhaseProgress(progressOptions, 100);
        loaderLoadedThisRun = true;
      }

      if (kind === 'image') {
        let device = await ensureDeviceBeforeFlash('image');
        if (deviceNeedsLoaderBeforeImage(device)) {
          if (loaderLoadedThisRun) {
            logMaskromAfterSuccessfulLoader();
          } else {
            emit('log', { line: 'Device is in Maskrom mode; loading the configured Maskrom loader before writing the image.' });
            const loader = implicitLoaderOptions(options);
            const prerequisiteProgress = {
              progressLabel: 'Maskrom loader prerequisite',
              progressOffset: progressOptions.progressOffset,
              progressScale: 0
            };
            loader.progressOptions = prerequisiteProgress;
            const loaderPath = await prepareLoader(loader);
            await writeLoader(loaderPath, prerequisiteProgress, 'Loading Maskrom loader before image...');
            loaderLoadedThisRun = true;

            device = await ensureDeviceBeforeFlash('image');
            if (deviceNeedsLoaderBeforeImage(device)) {
              logMaskromAfterSuccessfulLoader();
            }
          }
        }

        const imageProgress = splitProgressForSource(progressOptions, options.imageSource);
        const imagePath = await prepareFile('image', options.imageSource, options.imagePath, imageProgress.download);
        emit('status', { message: 'Writing image...' });
        appState.flashBusy = true;
        emit('flash-busy', { value: true });
        try {
          await runTool(['wl', String(appState.config.image.lba ?? 0), imagePath], imageProgress.flash);
        } finally {
          appState.flashBusy = false;
          emit('flash-busy', { value: false });
        }
        emitPhaseProgress(progressOptions, 100);
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

function appUpdateConfig() {
  return appState.config?.autoUpdate || {};
}

function shouldCheckForAppUpdate() {
  const config = appUpdateConfig();
  return config.enabled !== false && config.checkOnStartup !== false;
}

function isOnlineForAppUpdate() {
  return typeof net?.isOnline === 'function' ? net.isOnline() : true;
}

function scheduleAppUpdateCheck() {
  setTimeout(() => {
    maybeCheckForAppUpdate().catch((error) => {
      emit('log', { line: `Application update check failed: ${error.message}` });
    });
  }, 1000);
}

async function maybeCheckForAppUpdate() {
  if (!shouldCheckForAppUpdate()) {
    emit('log', { line: 'Application update check disabled.' });
    return;
  }
  const config = appUpdateConfig();
  const isOnline = isOnlineForAppUpdate();
  if (!isOnline) {
    emit('log', { line: 'Application offline: skipping update check.' });
    return;
  }

  const update = await checkForAppUpdate({
    enabled: true,
    isOnline,
    currentVersion: app.getVersion(),
    releaseApiUrl: config.releaseApiUrl,
    platform: process.platform,
    arch: process.arch,
    linuxPackage: config.linuxPackage,
    fetchImpl: fetch,
    timeoutMs: normalizeTimeoutMs(config.metadataTimeoutMs, 300000)
  });

  if (!update.available) {
    emit('log', { line: 'Application is up to date.' });
    return;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Update now', 'Later'],
    defaultId: 1,
    cancelId: 1,
    title: 'Application update available',
    message: `RK Firmware Updater ${update.latestVersion} is available.`,
    detail: [
      `Current version: ${update.currentVersion}`,
      `Installer: ${update.asset.name}`,
      'The installer will be downloaded and verified before it is started.'
    ].join('\n')
  });
  if (result.response !== 0) return;

  try {
    await downloadAndInstallAppUpdate(update.asset);
  } catch (error) {
    emit('log', { line: `Application update failed: ${error.message}` });
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      buttons: ['OK'],
      title: 'Application update failed',
      message: 'The application update could not be installed.',
      detail: `${error.message}\n\nThe current application was not changed.`
    });
  }
}

async function downloadAndInstallAppUpdate(asset) {
  if (appState.busy) {
    throw new Error('Cannot install an application update while another operation is running.');
  }
  const config = appUpdateConfig();
  appState.busy = true;
  emit('busy', { value: true });
  emit('status', { message: `Downloading application update ${asset.name}...` });
  emit('progress', { label: 'Downloading application update', value: 0 });

  try {
    const download = await downloadUpdateAsset(asset, {
      downloadDir: path.join(app.getPath('userData'), 'app-updates'),
      fetchImpl: fetch,
      timeoutMs: normalizeTimeoutMs(config.downloadTimeoutMs, 7200000),
      onProgress: (value) => emit('progress', { label: 'Downloading application update', value })
    });
    emit('log', { line: `Application update SHA256 OK ${path.basename(download.filePath)}: ${download.sha256}` });
    emit('status', { message: 'Starting application update installer...' });
    emit('progress', { label: 'Starting installer', value: 100 });
    await installUpdate(download.filePath, {
      platform: process.platform,
      timeoutMs: normalizeTimeoutMs(config.installTimeoutMs, 1800000)
    });
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['OK'],
      title: 'Application update started',
      message: 'The application update installer has been started.',
      detail: 'Follow the installer instructions, then restart RK Firmware Updater.'
    });
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

function markMainWindowReady() {
  appState.windowlessTransition = false;
  scheduleAppUpdateCheck();
}

async function showNoDeviceChoice() {
  let noDeviceWindow = null;
  let settled = false;

  return new Promise((resolve, reject) => {
    function settle(choice) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('no-device:choice', onChoice);
      if (noDeviceWindow && !noDeviceWindow.isDestroyed()) {
        noDeviceWindow.close();
      }
      resolve(choice);
    }

    function onChoice(event, choice) {
      if (!noDeviceWindow || event.sender !== noDeviceWindow.webContents) return;
      if (choice === 'simulate' || choice === 'try-again') {
        settle(choice);
        return;
      }
      settle('close');
    }

    ipcMain.on('no-device:choice', onChoice);
    createBrowserNoDeviceWindow({
      BrowserWindow,
      preloadPath: path.join(__dirname, 'no-device-preload.js'),
      htmlPath: path.join(__dirname, 'no-device.html')
    }).then((window) => {
      noDeviceWindow = window;
      noDeviceWindow.on('closed', () => settle('close'));
    }).catch((error) => {
      ipcMain.removeListener('no-device:choice', onChoice);
      reject(error);
    });
  });
}

ipcMain.handle('app:getInitialState', () => ({
  device: appState.device,
  ...configStatePayload(),
  platform: os.platform(),
  simulation: appState.simulation
}));

ipcMain.handle('app:getConfigJson', () => formatConfigJson(appState.config));

ipcMain.handle('app:loadExternalConfigFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON configuration', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const config = parseEditableConfig(fs.readFileSync(filePath, 'utf8'));
  return {
    canceled: false,
    filePath,
    json: formatConfigJson(config)
  };
});

ipcMain.handle('app:exportConfigFile', async (_event, jsonText) => {
  const config = parseEditableConfig(jsonText);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'rkdeveloptool-gui.config.json',
    filters: [
      { name: 'JSON configuration', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  fs.writeFileSync(result.filePath, formatConfigJson(config), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('app:applyConfig', async (_event, jsonText) => {
  if (appState.busy) {
    throw new Error('Cannot apply configuration while another operation is running.');
  }
  const config = parseEditableConfig(jsonText);
  const filePath = applyConfigObject(config);
  announceConfigSources();
  return {
    ok: true,
    filePath,
    json: formatConfigJson(appState.config),
    ...configStatePayload()
  };
});

ipcMain.handle('app:resetConfig', async () => {
  if (appState.busy) {
    throw new Error('Cannot reset configuration while another operation is running.');
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Reset to defaults', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset parameters',
    message: 'Reset all parameters to the default values?',
    detail: 'The current user configuration will be overwritten with the packaged default configuration.'
  });
  if (result.response !== 0) {
    return { canceled: true };
  }

  const config = loadDefaultConfig();
  const filePath = applyConfigObject(config);
  announceConfigSources();
  return {
    canceled: false,
    filePath,
    json: formatConfigJson(appState.config),
    ...configStatePayload()
  };
});

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
      'The Maskrom loader is loaded before writing the complete image.',
      ...(normalizedOptions.loaderSource === 'online' && normalizedOptions.loaderChoiceLabel
        ? [`Selected Maskrom loader: ${normalizedOptions.loaderChoiceLabel}`]
        : []),
      `Release API host: ${sources.releaseApiHost || 'not configured'}`,
      `Maskrom loader host: ${sources.loaderHost || 'not configured'}`,
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

ipcMain.handle('app:showRebootSuccess', async () => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['OK'],
    title: 'Device reboot command sent',
    message: 'You can disconnect the USB-C cable after the device has rebooted correctly.',
    detail: appState.simulation
      ? 'Simulation mode: no real device was rebooted.'
      : 'Wait until the receiver has restarted normally before unplugging USB-C.'
  });
  return { ok: true };
});

ipcMain.handle('app:confirmRebootFailure', async (_event, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    buttons: ['Try reboot again', 'Do not reboot now', 'Force close app'],
    defaultId: 0,
    cancelId: 1,
    title: 'Device reboot failed',
    message: 'The reboot command did not complete successfully.',
    detail: [
      String(message || 'Unknown reboot error.'),
      '',
      'Recommended: keep the device connected and try reboot again.',
      'Force close is discouraged because the device state may be unclear.'
    ].join('\n')
  });

  if (result.response === 0) return 'retry';
  if (result.response === 2) return 'force-close';
  return 'keep-open';
});

ipcMain.handle('app:reboot', async () => {
  if (appState.flashBusy) {
    throw new Error('Cannot reboot while a flash command is running.');
  }
  if (appState.rebooting) {
    throw new Error('A reboot command is already running.');
  }
  appState.rebooting = true;
  try {
    await runTool(['rd']);
    emit('log', { line: 'Reboot command sent.' });
    return { ok: true };
  } finally {
    appState.rebooting = false;
  }
});

ipcMain.handle('app:forceClose', () => {
  app.quit();
  return { ok: true };
});

async function detectDeviceWithNoDeviceWorkflow() {
  while (true) {
    const devices = await detectSingleDevice();
    if (devices.length > 0) {
      return devices;
    }

    appState.windowlessTransition = true;
    const choice = await showNoDeviceChoice();

    if (choice === 'try-again') {
      continue;
    }

    if (choice === 'simulate') {
      return [];
    }

    app.quit();
    return null;
  }
}

app.whenReady().then(async () => {
  try {
    const loadedConfig = loadConfig();
    appState.config = loadedConfig.config;
    appState.configOverrides = loadedConfig.overrides;
    const tool = findRkdeveloptool(appState.config);
    appState.rkdeveloptoolPath = tool.path;
    appState.rkdeveloptoolSearchPaths = tool.searchPaths;
    const devices = await detectDeviceWithNoDeviceWorkflow();
    if (!devices) {
      return;
    }
    if (devices.length === 0) {
      setActiveDevice(simulatedDevice(), true);
      await createMainWindow();
      announceConfigSources();
      emit('log', { line: 'Simulation mode: no real device will be flashed.' });
      markMainWindowReady();
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
    setActiveDevice(devices[0], false);
    await createMainWindow();
    announceConfigSources();
    markMainWindowReady();
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
  emit('log', { line: `Maskrom loader host: ${sources.loaderHost || 'not configured'}` });
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
  if (appState.windowlessTransition) {
    return;
  }
  if (appState.busy) {
    warnOperationInProgress();
    return;
  }
  app.quit();
});
