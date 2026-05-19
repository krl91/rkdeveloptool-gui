const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const noDeviceHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'no-device.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
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

test('quick online update button is visually marked as a warning', () => {
  assert.match(html, /id="quickUpdateButton"\s+class="warning"/);
  assert.match(css, /\.warning\s*\{[\s\S]*background:\s*var\(--warning\);/);
  assert.match(html, /Loads the Maskrom loader, then writes the complete online image\./);
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

test('no-device screen shows the RunCam flash-button image and simulation action', () => {
  assert.match(noDeviceHtml, /runcam-wifilink-rx-flash-button\.(svg|png)/);
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

test('main process loads a loader prerequisite before image writes from Maskrom', () => {
  assert.match(main, /deviceNeedsLoaderBeforeImage\(device\)/);
  assert.match(main, /Device is in Maskrom mode; loading the configured Maskrom loader before writing the image\./);
  assert.match(main, /await writeLoader\(loaderPath,[\s\S]*'Loading Maskrom loader before image\.\.\.'\);/);
  assert.match(main, /The device is still in Maskrom after loading the loader/);
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
});

test('renderer falls back safely when no radio input is selected', () => {
  assert.match(renderer, /return radio \? radio\.value : 'online';/);
});
