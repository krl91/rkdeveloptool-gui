const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..');
const guiRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'docs', 'assets', 'screenshots');
const css = fs.readFileSync(path.join(guiRoot, 'src', 'styles.css'), 'utf8');
const loaderUrl = 'https://dl.radxa.com/rock3/images/loader/rock-3a/rk356x_spl_loader_ddr1056_v1.10.111.bin';
const imageUrl = 'https://github.com/OpenIPC/sbc-groundstations/releases/download/buildroot-snapshot/runcam_wifilink_sdcard.img';
const noDevicePageUrl = pathToFileURL(path.join(guiRoot, 'src', 'no-device.html')).href;

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'msedge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate) && commandExists(candidate)) return candidate;
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH to a Chromium-compatible browser.');
}

function htmlPage(body, extraStyle = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RK Firmware Updater screenshot</title>
    <style>${css}</style>
    <style>${extraStyle}</style>
  </head>
  <body>${body}</body>
</html>`;
}

function appBody(options = {}) {
  const progress = options.progress || 0;
  const progressLabel = options.progressLabel || 'Ready';
  const status = options.status || 'Simulation';
  const statusClass = options.statusClass || '';
  const log = options.log || '';
  const rebootDisabled = options.rebootEnabled ? '' : 'disabled';
  const view = options.view || 'flash';
  const flashSelected = view === 'flash';
  const parametersSelected = view === 'parameters';
  const configJson = JSON.stringify({
    rkdeveloptoolPath: '',
    commandPrefix: [],
    releasePageUrl: 'https://github.com/OpenIPC/sbc-groundstations/releases/tag/buildroot-snapshot',
    releaseApiUrl: 'https://api.github.com/repos/OpenIPC/sbc-groundstations/releases/tags/buildroot-snapshot',
    documentationUrl: 'https://github.com/krl91/rkdeveloptool-gui/blob/main/docs/USER_GUIDE.md',
    rkdeveloptoolCommandDelayMs: 2000,
    network: {
      metadataTimeoutMs: 300000,
      downloadTimeoutMs: 7200000
    },
    loader: {
      assetName: 'rk356x_spl_loader_ddr1056_v1.10.111.bin',
      url: loaderUrl,
      choices: [
        {
          id: 'rk356x-v1.10.111',
          label: 'Radxa RK356x SPL v1.10.111',
          assetName: 'rk356x_spl_loader_ddr1056_v1.10.111.bin',
          url: loaderUrl
        }
      ]
    },
    image: {
      assetName: 'runcam_wifilink_sdcard.img',
      url: imageUrl,
      lba: 0
    }
  }, null, 2);

  return `
<div class="app-layout">
<nav class="sidebar" aria-label="Main navigation">
  <div class="sidebar-title">RK</div>
  <button id="flashTab" class="nav-tab ${flashSelected ? 'active' : ''}" type="button" data-view="flash" ${flashSelected ? 'aria-current="page"' : ''}>Flash</button>
  <button id="parametersTab" class="nav-tab ${parametersSelected ? 'active' : ''}" type="button" data-view="parameters" ${parametersSelected ? 'aria-current="page"' : ''}>Parameters</button>
</nav>
<main class="shell">
  <header class="topbar">
    <div>
      <h1>RK Firmware Updater</h1>
      <p id="deviceLine" class="muted">Vid=0x2207, Pid=0x320a, LocationID=SIMULATED, Simulation</p>
    </div>
    <div class="topbar-actions">
      <button id="documentationButton" class="secondary" type="button">User guide</button>
      <button id="connectDeviceButton" class="secondary" type="button">Connect device</button>
      <button id="rebootButton" class="secondary" type="button" ${rebootDisabled}>Reboot</button>
    </div>
  </header>

  <section id="flashView" class="view ${flashSelected ? 'active' : ''}" data-view-panel="flash" ${flashSelected ? '' : 'hidden'}>
  <section class="panel controls">
    <div class="section-header">
      <h2>Update</h2>
      <div class="quick-update">
        <button id="quickUpdateButton" class="warning" type="button">Flash full image</button>
        <p>Loads the Maskrom loader, then writes the selected complete image.</p>
      </div>
    </div>

    <div class="progress-block top-progress">
      <div class="progress-label">
        <span id="progressLabel">${progressLabel}</span>
        <span id="progressValue">${progress}%</span>
      </div>
      <progress id="progressBar" value="${progress}" max="100"></progress>
    </div>

    <div class="update-grid">
      <article class="update-card">
        <label class="check-row">
          <input id="updateLoader" type="checkbox" checked>
          <span>Maskrom loader</span>
        </label>
        <div class="segmented" role="group" aria-label="Source Maskrom loader">
          <label><input type="radio" name="loaderSource" value="online" checked><span>Online</span></label>
          <label><input type="radio" name="loaderSource" value="local"><span>Manual</span></label>
        </div>
        <label class="field-label" for="loaderChoice">Maskrom loader type</label>
        <select id="loaderChoice">
          <option>Radxa RK356x SPL v1.10.111</option>
        </select>
        <div class="file-row">
          <input id="loaderPath" type="text" readonly placeholder="No local file" disabled>
          <button id="chooseLoader" class="secondary" type="button" disabled>Choose</button>
        </div>
        <p id="loaderUrl" class="asset-url">${loaderUrl}</p>
      </article>

      <article class="update-card">
        <label class="check-row">
          <input id="updateImage" type="checkbox" checked>
          <span>Image</span>
        </label>
        <div class="segmented" role="group" aria-label="Source image">
          <label><input type="radio" name="imageSource" value="online" checked><span>Online</span></label>
          <label><input type="radio" name="imageSource" value="local"><span>Local</span></label>
        </div>
        <div class="file-row">
          <input id="imagePath" type="text" readonly placeholder="No local file" disabled>
          <button id="chooseImage" class="secondary" type="button" disabled>Choose</button>
        </div>
        <p id="imageUrl" class="asset-url">${imageUrl}</p>
      </article>
    </div>

    <div class="action-row">
      <button id="startButton" class="primary" type="button">Start</button>
    </div>
  </section>

  <section class="panel log-panel">
    <div class="section-header">
      <h2>Log</h2>
      <span id="statusText" class="status-pill ${statusClass}">${status}</span>
    </div>
    <pre id="log">${log}</pre>
  </section>
  </section>

  <section id="parametersView" class="view ${parametersSelected ? 'active' : ''}" data-view-panel="parameters" ${parametersSelected ? '' : 'hidden'}>
    <section class="panel parameters-panel">
      <div class="section-header">
        <h2>Parameters</h2>
        <div class="parameters-actions">
          <button id="loadConfigButton" class="secondary" type="button">Load external file</button>
          <button id="exportConfigButton" class="secondary" type="button">Export file</button>
          <button id="resetConfigButton" class="danger-secondary" type="button">Reset</button>
          <button id="applyConfigButton" class="primary" type="button">Apply</button>
        </div>
      </div>
      <p class="parameters-help">Edit the complete JSON configuration. Apply saves it as the application user configuration.</p>
      <textarea id="configEditor" spellcheck="false" aria-label="JSON configuration">${configJson}</textarea>
      <div class="parameters-grid">
        <article class="parameter-row">
          <span>Release API</span>
          <strong id="parameterReleaseApi">api.github.com</strong>
        </article>
        <article class="parameter-row">
          <span>Maskrom loader source</span>
          <strong id="parameterLoaderSource">dl.radxa.com</strong>
        </article>
        <article class="parameter-row">
          <span>Image source</span>
          <strong id="parameterImageSource">github.com</strong>
        </article>
      </div>
    </section>
  </section>
</main>
</div>`;
}

function dialogBody(title, message, primary, secondary, warning = false) {
  const accent = warning ? '#f97316' : '#1f6feb';
  return `
<section class="dialog" aria-label="${title}">
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="actions">
    <button>${secondary}</button>
    <button class="primary">${primary}</button>
  </div>
</section>
<style>
  body {
    display: grid;
    place-items: center;
    background: #eef2f6;
  }
  .dialog {
    width: min(680px, calc(100vw - 48px));
    padding: 28px;
    border: 1px solid #d8dee8;
    border-radius: 14px;
    background: white;
    box-shadow: 0 24px 70px rgba(16, 24, 40, 0.22);
  }
  .dialog h1 { margin: 0 0 12px; font-size: 26px; line-height: 1.2; }
  .dialog p { margin: 0; color: #5f6b7a; font-size: 16px; line-height: 1.5; }
  .actions { margin-top: 28px; display: flex; justify-content: flex-end; gap: 12px; }
  .dialog button {
    min-width: 132px;
    height: 42px;
    border-radius: 8px;
    border: 1px solid #d8dee8;
    padding: 0 16px;
    background: white;
    color: #17202a;
    font: inherit;
    font-weight: 600;
  }
  .dialog .primary { border-color: ${accent}; background: ${accent}; color: white; }
</style>`;
}

function renderScreenshot(chrome, filename, html, width = 1280, height = 900) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkdeveloptool-docs-'));
  const htmlPath = path.join(tempDir, `${path.basename(filename, '.png')}.html`);
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(htmlPath, html);

  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--screenshot=${outputPath}`,
    pathToFileURL(htmlPath).href
  ], { encoding: 'utf8' });

  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(`Failed to capture ${filename}:\n${result.stderr || result.stdout}`);
  }
}

function renderUrlScreenshot(chrome, filename, url, width = 1280, height = 900) {
  const outputPath = path.join(outputDir, filename);
  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--screenshot=${outputPath}`,
    url
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`Failed to capture ${filename}:\n${result.stderr || result.stdout}`);
  }
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const chrome = findChrome();

  renderUrlScreenshot(chrome, '01-no-device-simulation-choice.png', noDevicePageUrl, 1040, 820);

  renderScreenshot(chrome, '02-main-window.png', htmlPage(appBody()), 1280, 900);

  renderScreenshot(chrome, '06-parameters-tab.png', htmlPage(appBody({
    view: 'parameters'
  })), 1280, 900);

  renderScreenshot(chrome, '03-confirm-update.png', htmlPage(dialogBody(
    'Confirm firmware update',
    'The updater will load the Maskrom loader first, then write the complete image to LBA 0. Online files will be downloaded before flashing.',
    'Start update',
    'Cancel',
    true
  )), 980, 560);

  renderScreenshot(chrome, '04-update-progress.png', htmlPage(appBody({
    progress: 75,
    progressLabel: 'Writing image',
    status: 'Updating...',
    log: [
      'Simulation mode: no real device will be flashed.',
      'SHA256 rk356x_spl_loader_ddr1056_v1.10.111.bin: calculated-at-runtime (no expected checksum configured)',
      '$ SIMULATION rkdeveloptool db rk356x_spl_loader_ddr1056_v1.10.111.bin',
      'Simulation: Maskrom loader OK.',
      'SHA256 OK runcam_wifilink_sdcard.img: e087dfeee1dc93e749f2e41fe16323366d77c1fe1d96a7c70484d1080866e77e',
      '$ SIMULATION rkdeveloptool wl 0 runcam_wifilink_sdcard.img',
      'Simulation Write LBA from file (25%)',
      'Simulation Write LBA from file (50%)',
      'Simulation Write LBA from file (75%)'
    ].join('\n')
  })), 1280, 900);

  renderScreenshot(chrome, '05-update-complete.png', htmlPage(appBody({
    progress: 100,
    progressLabel: 'Done',
    status: 'Done',
    statusClass: 'ok',
    rebootEnabled: true,
    log: [
      'Simulation mode: no real device will be flashed.',
      'SHA256 rk356x_spl_loader_ddr1056_v1.10.111.bin: calculated-at-runtime (no expected checksum configured)',
      '$ SIMULATION rkdeveloptool db rk356x_spl_loader_ddr1056_v1.10.111.bin',
      'Simulation: Maskrom loader OK.',
      'SHA256 OK runcam_wifilink_sdcard.img: e087dfeee1dc93e749f2e41fe16323366d77c1fe1d96a7c70484d1080866e77e',
      '$ SIMULATION rkdeveloptool wl 0 runcam_wifilink_sdcard.img',
      'Simulation Write LBA from file (100%)',
      'Update complete.'
    ].join('\n')
  })), 1280, 900);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
