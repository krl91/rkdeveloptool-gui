const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const noDeviceHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'no-device.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

test('layout allows the window to scroll when content is taller than the viewport', () => {
  assert.match(css, /body\s*\{[\s\S]*overflow:\s*auto;/);
});

test('loader and image cards reflow instead of overflowing horizontally', () => {
  assert.match(css, /\.update-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(360px,\s*100%\),\s*1fr\)\);/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.update-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test('long log lines wrap so the console does not force horizontal overflow', () => {
  assert.match(css, /pre\s*\{[\s\S]*white-space:\s*pre-wrap;/);
  assert.match(css, /pre\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
});

test('mobile action row stacks controls and keeps buttons accessible', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.action-row\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*button\s*\{[\s\S]*width:\s*100%;/);
});

test('quick full-image button is visually marked as a warning and keeps selected sources', () => {
  assert.match(html, /id="quickUpdateButton"\s+class="warning"/);
  assert.match(css, /\.warning\s*\{[\s\S]*background:\s*var\(--warning\);/);
  assert.match(html, /Loads the Maskrom loader, then writes the selected complete image\./);
  const quickHandler = renderer.match(/elements\.quickUpdateButton\.addEventListener\('click', \(\) => \{[\s\S]*?\n\}\);/)[0];
  assert.match(quickHandler, /elements\.updateLoader\.checked = true;/);
  assert.match(quickHandler, /elements\.updateImage\.checked = true;/);
  assert.doesNotMatch(quickHandler, /input\[name="imageSource"\]\[value="online"\]/);
  assert.doesNotMatch(quickHandler, /input\[name="loaderSource"\]\[value="online"\]/);
});

test('loader card exposes preset loader choices plus manual local mode', () => {
  assert.match(html, /id="loaderChoice"/);
  assert.match(html, /<span>Manual<\/span>/);
  assert.match(renderer, /loaderChoiceId: elements\.loaderChoice\.value/);
  assert.match(renderer, /loaderChoiceLabel: elements\.loaderChoice\.selectedOptions\[0\]\?\.textContent/);
  assert.match(renderer, /state\.config\.loader\.choices/);
  assert.match(renderer, /option\.dataset\.url = choice\.url/);
});

test('renderer document declares a restrictive content security policy', () => {
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
});

test('main window exposes left navigation tabs for flash and parameters views', () => {
  assert.match(html, /<nav class="sidebar" aria-label="Main navigation">/);
  assert.match(html, /id="flashTab"[\s\S]*data-view="flash"[\s\S]*>Flash<\/button>/);
  assert.match(html, /id="parametersTab"[\s\S]*data-view="parameters"[\s\S]*>Parameters<\/button>/);
  assert.match(html, /id="flashView"[\s\S]*data-view-panel="flash"/);
  assert.match(html, /id="parametersView"[\s\S]*data-view-panel="parameters"[\s\S]*hidden/);
  assert.match(css, /\.app-layout\s*\{[\s\S]*grid-template-columns:\s*164px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*position:\s*sticky;/);
});

test('renderer switches tabs without disrupting the flash view', () => {
  assert.match(renderer, /function switchView\(viewName\)/);
  assert.match(renderer, /tab\.classList\.toggle\('active', selected\);/);
  assert.match(renderer, /tab\.setAttribute\('aria-current', 'page'\);/);
  assert.match(renderer, /view\.hidden = view\.dataset\.viewPanel !== viewName;/);
  assert.match(renderer, /elements\.flashTab\.addEventListener\('click', \(\) => switchView\('flash'\)\);/);
  assert.match(renderer, /elements\.parametersTab\.addEventListener\('click', \(\) => switchView\('parameters'\)\);/);
});

test('parameters view shows configured source hosts', () => {
  assert.match(html, /id="parameterReleaseApi"/);
  assert.match(html, /id="parameterLoaderSource"/);
  assert.match(html, /id="parameterImageSource"/);
  assert.match(renderer, /elements\.parameterReleaseApi\.textContent = state\.configInfo\?\.source\?\.releaseApiHost/);
  assert.match(renderer, /elements\.parameterLoaderSource\.textContent = state\.configInfo\?\.source\?\.loaderHost/);
  assert.match(renderer, /elements\.parameterImageSource\.textContent = state\.configInfo\?\.source\?\.imageHost/);
});

test('parameters view exposes JSON import export and apply actions', () => {
  assert.match(html, /id="configEditor"[\s\S]*aria-label="JSON configuration"/);
  assert.match(html, /id="loadConfigButton"[\s\S]*Load external file/);
  assert.match(html, /id="exportConfigButton"[\s\S]*Export file/);
  assert.match(html, /id="resetConfigButton"[\s\S]*Reset/);
  assert.match(html, /id="applyConfigButton"[\s\S]*Apply/);
  assert.match(css, /#configEditor\s*\{[\s\S]*font:\s*12px\/1\.45 ui-monospace/);
  assert.match(css, /\.danger-secondary\s*\{[\s\S]*color:\s*var\(--danger\);/);
  assert.match(preload, /getConfigJson: \(\) => ipcRenderer\.invoke\('app:getConfigJson'\)/);
  assert.match(preload, /loadExternalConfigFile: \(\) => ipcRenderer\.invoke\('app:loadExternalConfigFile'\)/);
  assert.match(preload, /exportConfigFile: \(jsonText\) => ipcRenderer\.invoke\('app:exportConfigFile', jsonText\)/);
  assert.match(preload, /applyConfig: \(jsonText\) => ipcRenderer\.invoke\('app:applyConfig', jsonText\)/);
  assert.match(preload, /resetConfig: \(\) => ipcRenderer\.invoke\('app:resetConfig'\)/);
  assert.match(renderer, /elements\.configEditor\.value = await window\.rkGui\.getConfigJson\(\);/);
  assert.match(renderer, /window\.rkGui\.loadExternalConfigFile\(\)/);
  assert.match(renderer, /window\.rkGui\.exportConfigFile\(elements\.configEditor\.value\)/);
  assert.match(renderer, /window\.rkGui\.applyConfig\(elements\.configEditor\.value\)/);
  assert.match(renderer, /window\.rkGui\.resetConfig\(\)/);
});

test('main process validates imports and saves applied or reset JSON as user configuration', () => {
  assert.match(main, /function parseEditableConfig\(jsonText\)/);
  assert.match(main, /Invalid JSON configuration/);
  assert.match(main, /function loadDefaultConfig\(\)/);
  assert.match(main, /function userConfigPath\(\)[\s\S]*rkdeveloptool-gui\.config\.json/);
  assert.match(main, /function writeUserConfig\(config\)[\s\S]*fs\.writeFileSync\(tempDestination, formatConfigJson\(config\), 'utf8'\);[\s\S]*fs\.renameSync\(tempDestination, destination\);/);
  assert.match(main, /ipcMain\.handle\('app:loadExternalConfigFile'/);
  assert.match(main, /ipcMain\.handle\('app:exportConfigFile'/);
  assert.match(main, /ipcMain\.handle\('app:applyConfig'/);
  assert.match(main, /ipcMain\.handle\('app:resetConfig'/);
  assert.match(main, /Reset all parameters to the default values\?/);
  assert.match(main, /const config = loadDefaultConfig\(\);/);
  assert.match(main, /appState\.config = config;/);
  assert.match(main, /appState\.rkdeveloptoolPath = tool\.path;/);
});

test('left navigation collapses above the content on mobile', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.app-layout\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.sidebar\s*\{[\s\S]*position:\s*static;/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.sidebar\s*\{[\s\S]*grid-template-columns:\s*auto 1fr 1fr;/);
});

test('no-device screen shows the RunCam flash-button image and simulation action', () => {
  assert.match(noDeviceHtml, /runcam-wifilink-rx-flash-button\.png/);
  assert.doesNotMatch(noDeviceHtml, /runcam-wifilink-rx-flash-button\.svg/);
  assert.match(noDeviceHtml, /No Rockusb device was detected/);
  assert.match(noDeviceHtml, /USB-C data cable/);
  assert.match(noDeviceHtml, /reset\/flash button/);
  assert.match(noDeviceHtml, /Try again/);
  assert.match(noDeviceHtml, /Simulate a device/);
  assert.match(noDeviceHtml, /Content-Security-Policy/);
  assert.match(noDeviceHtml, /script-src 'none'/);
});

test('no-device screen keeps actions reachable in short macOS windows', () => {
  assert.match(noDeviceHtml, /body\s*\{[\s\S]*height:\s*100vh;/);
  assert.match(noDeviceHtml, /body\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(noDeviceHtml, /\.panel\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(noDeviceHtml, /\.actions\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(noDeviceHtml, /\.actions\s*\{[\s\S]*bottom:\s*0;/);
  assert.match(noDeviceHtml, /\.actions\s*\{[\s\S]*flex-shrink:\s*0;/);
});

test('simulation choice keeps the app alive while switching windows', () => {
  assert.match(main, /windowlessTransition:\s*false/);
  assert.match(main, /appState\.windowlessTransition\s*=\s*true;/);
  assert.match(main, /choice === 'try-again'/);
  assert.match(main, /continue;/);
  assert.match(main, /if \(appState\.windowlessTransition\)\s*\{\s*return;\s*\}/);
});

test('try-again transition stays active until the main window is ready', () => {
  assert.match(main, /function markMainWindowReady\(\)\s*\{[\s\S]*appState\.windowlessTransition\s*=\s*false;/);
  assert.doesNotMatch(main, /const choice = await showNoDeviceChoice\(\);\s*appState\.windowlessTransition\s*=\s*false;/);
  assert.match(main, /await createMainWindow\(\);\s*announceConfigSources\(\);\s*markMainWindowReady\(\);/);
});

test('main process checks the USB device immediately before each flash command', () => {
  assert.match(main, /async function writeLoader\(loaderPath[\s\S]*await ensureDeviceBeforeFlash\('loader'\);[\s\S]*await runTool\(\['db', loaderPath\]/);
  assert.match(main, /let device = await ensureDeviceBeforeFlash\('image'\);[\s\S]*const imagePath = await prepareFile\('image'[\s\S]*await runTool\(\['wl', String\(appState\.config\.image\.lba \?\? 0\), imagePath\]/);
  assert.match(renderer, /if \(event\.type === 'device'\)[\s\S]*updateDeviceLine\(event\.device\);/);
});

test('download and flash failures stop the workflow with clear user-facing errors', () => {
  assert.match(main, /function explainDownloadFailure\(asset, error\)/);
  assert.match(main, /Download failed for \$\{asset\.name\}\./);
  assert.match(main, /The update has been stopped before flashing\./);
  assert.match(main, /SHA256 verification failed for \$\{asset\.name\}\./);
  assert.match(main, /Maskrom loader flash failed\./);
  assert.match(main, /Image flash failed\./);
  assert.match(main, /The update has been stopped\. Do not continue until the receiver is back in Maskrom mode\./);
  assert.match(main, /The update has been stopped\. Keep the device connected and check the error before retrying\./);
  assert.match(renderer, /function cleanErrorMessage\(error\)/);
  assert.match(renderer, /Error invoking remote method/);
  assert.match(renderer, /setProgress\('Failed', elements\.progressBar\.value\);/);
});

test('reboot stays available during downloads and is blocked only while flashing', () => {
  const rebootHandler = main.slice(
    main.indexOf("ipcMain.handle('app:reboot'"),
    main.indexOf("ipcMain.handle('app:forceClose'")
  );
  const performRebootBlock = renderer.slice(
    renderer.indexOf('async function performReboot'),
    renderer.indexOf('window.rkGui.onEvent')
  );

  assert.match(main, /flashBusy:\s*false/);
  assert.match(main, /rebooting:\s*false/);
  assert.match(main, /emit\('flash-busy', \{ value: true \}\);[\s\S]*await runTool\(\['db', loaderPath\]/);
  assert.match(main, /await runTool\(\['wl', String\(appState\.config\.image\.lba \?\? 0\), imagePath\], imageProgress\.flash\);[\s\S]*emit\('flash-busy', \{ value: false \}\);/);
  assert.match(rebootHandler, /if \(appState\.flashBusy\) \{[\s\S]*Cannot reboot while a flash command is running\./);
  assert.doesNotMatch(rebootHandler, /if \(appState\.busy\)/);
  assert.doesNotMatch(rebootHandler, /emit\('busy'/);
  assert.match(renderer, /let flashBusy = false;/);
  assert.match(renderer, /elements\.rebootButton\.disabled = flashBusy \|\| rebootInFlight \|\| !rebootAvailable;/);
  assert.match(renderer, /function setFlashBusy\(value\) \{[\s\S]*updateRebootButton\(\);[\s\S]*\}/);
  assert.match(renderer, /if \(event\.type === 'flash-busy'\) setFlashBusy\(event\.value\);/);
  assert.match(renderer, /const state = await window\.rkGui\.getInitialState\(\);[\s\S]*rebootAvailable = true;[\s\S]*updateRebootButton\(\);/);
  assert.doesNotMatch(performRebootBlock, /rebootAvailable = false;/);
});

test('main process loads a loader prerequisite before image writes from Maskrom', () => {
  assert.match(main, /deviceNeedsLoaderBeforeImage\(device\)/);
  assert.match(main, /Device is in Maskrom mode; loading the configured Maskrom loader before writing the image\./);
  assert.match(main, /await writeLoader\(loaderPath,[\s\S]*'Loading Maskrom loader before image\.\.\.'\);/);
  assert.match(main, /still reports Maskrom after loading the loader; continuing because rkdeveloptool reported the loader was loaded successfully/);
  assert.doesNotMatch(main, /The device is still in Maskrom after loading the loader/);
});

test('main process assigns one progress range per selected flash step', () => {
  assert.match(main, /function emitPhaseProgress\(progressOptions, percent, label = progressOptions\.progressLabel\)/);
  assert.match(main, /mappedPhaseProgress\(progressOptions, percent\)/);
  assert.match(main, /phaseProgressRange\(\s*index,\s*plan\.length,/);
  assert.match(main, /emitPhaseProgress\(progressOptions, 0\);/);
  assert.match(main, /const loaderProgress = splitProgressForSource\(progressOptions, options\.loaderSource\);[\s\S]*progressOptions: loaderProgress\.download[\s\S]*await writeLoader\(loaderPath, loaderProgress\.flash\);[\s\S]*emitPhaseProgress\(progressOptions, 100\);/);
  assert.match(main, /const imageProgress = splitProgressForSource\(progressOptions, options\.imageSource\);[\s\S]*prepareFile\('image', options\.imageSource, options\.imagePath, imageProgress\.download\)[\s\S]*await runTool\(\['wl', String\(appState\.config\.image\.lba \?\? 0\), imagePath\], imageProgress\.flash\);[\s\S]*emitPhaseProgress\(progressOptions, 100\);/);
  assert.match(main, /downloadAndVerify\(asset, progressOptions\)/);
  assert.match(main, /emitPhaseProgress\(progressOptions, Math\.floor\(\(received \/ total\) \* 100\), `Downloading \$\{asset\.name\}`\)/);
});

test('custom configuration banner is present and hidden by default', () => {
  assert.match(html, /id="configBanner"\s+class="config-banner"\s+hidden/);
  assert.match(css, /\.config-banner\s*\{[\s\S]*background:\s*var\(--warning-bg\);/);
});

test('header exposes a user guide button wired to the main process', () => {
  assert.match(html, /id="documentationButton"[\s\S]*User guide/);
  assert.match(css, /\.topbar-actions\s*\{[\s\S]*display:\s*flex;/);
  assert.match(renderer, /window\.rkGui\.openDocumentation\(\)/);
});

test('renderer protects reboot against duplicate clicks', () => {
  assert.match(renderer, /let rebootInFlight = false;/);
  assert.match(renderer, /if \(rebootInFlight\) return;/);
  assert.match(renderer, /function updateRebootButton\(\)/);
  assert.match(renderer, /async function performReboot\(\{ confirmFirst = false \} = \{\}\)/);
  assert.match(renderer, /await window\.rkGui\.showRebootSuccess\(\)/);
  assert.match(renderer, /const choice = await window\.rkGui\.confirmRebootFailure\(cleanErrorMessage\(error\)\)/);
  assert.match(renderer, /if \(choice === 'retry'\)[\s\S]*continue;/);
  assert.match(renderer, /if \(choice === 'force-close'\)[\s\S]*await window\.rkGui\.forceClose\(\);/);
  assert.match(renderer, /elements\.rebootButton\.addEventListener\('click', \(\) => performReboot\(\)\);/);
  assert.match(renderer, /await performReboot\(\{ confirmFirst: true \}\);/);
});

test('renderer waits for final completed UI before proposing reboot', () => {
  const doneHandler = renderer.slice(
    renderer.indexOf("if (event.type === 'done')"),
    renderer.indexOf("for (const input")
  );

  assert.match(renderer, /function waitForUiPaint\(\)/);
  assert.match(renderer, /let firmwareUpdateActive = false;/);
  assert.match(renderer, /let firmwareUpdateFinished = false;/);
  assert.match(renderer, /let firmwareProgressFloor = 0;/);
  assert.match(renderer, /if \(firmwareUpdateFinished && normalized < 100\) return;/);
  assert.match(renderer, /if \(firmwareUpdateActive && normalized < firmwareProgressFloor\)/);
  assert.match(renderer, /function finishFirmwareProgress\(\)[\s\S]*firmwareUpdateFinished = true;[\s\S]*firmwareProgressFloor = 100;[\s\S]*setProgress\('Done', 100\);/);
  assert.match(renderer, /await window\.rkGui\.startUpdate\(options\);[\s\S]*finishFirmwareProgress\(\);[\s\S]*setStatus\('Done', 'ok'\);[\s\S]*rebootAvailable = true;[\s\S]*await waitForUiPaint\(\);[\s\S]*await performReboot\(\{ confirmFirst: true \}\);/);
  assert.match(doneHandler, /finishFirmwareProgress\(\);/);
  assert.doesNotMatch(doneHandler, /rebootAvailable = true;/);
});

test('main process explains reboot success and failed reboot choices', () => {
  assert.match(main, /ipcMain\.handle\('app:showRebootSuccess'/);
  assert.match(main, /You can disconnect the USB-C cable after the device has rebooted correctly\./);
  assert.match(main, /Wait until the receiver has restarted normally before unplugging USB-C\./);
  assert.match(main, /ipcMain\.handle\('app:confirmRebootFailure'/);
  assert.match(main, /buttons:\s*\['Try reboot again', 'Do not reboot now', 'Force close app'\]/);
  assert.match(main, /Force close is discouraged because the device state may be unclear\./);
  assert.match(main, /if \(result\.response === 0\) return 'retry';/);
  assert.match(main, /if \(result\.response === 2\) return 'force-close';/);
  assert.match(main, /return 'keep-open';/);
  assert.match(main, /ipcMain\.handle\('app:forceClose'/);
});

test('renderer falls back safely when no radio input is selected', () => {
  assert.match(renderer, /return radio \? radio\.value : 'online';/);
});
