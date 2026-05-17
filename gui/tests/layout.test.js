const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

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
