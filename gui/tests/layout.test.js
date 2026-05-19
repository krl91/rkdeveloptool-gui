const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
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
  assert.match(html, /Updates the loader first, then the image, using the latest online files\./);
});

test('renderer document declares a restrictive content security policy', () => {
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
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
