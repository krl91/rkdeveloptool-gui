const assert = require('node:assert/strict');
const test = require('node:test');

const { createMainWindow } = require('../src/windowFactory');

function createFakeBrowserWindow({ emitReadyDuringLoad }) {
  const instances = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.events = [];
      this.handlers = {};
      this.visible = false;
      instances.push(this);
    }

    once(eventName, handler) {
      this.events.push(`once:${eventName}`);
      this.handlers[eventName] = handler;
    }

    async loadFile(filePath) {
      this.events.push(`loadFile:${filePath}`);
      if (emitReadyDuringLoad) {
        this.handlers['ready-to-show']();
      }
    }

    show() {
      this.visible = true;
      this.events.push('show');
    }

    isVisible() {
      return this.visible;
    }
  }

  return { FakeBrowserWindow, instances };
}

test('main window is shown when ready-to-show fires during loadFile', async () => {
  const { FakeBrowserWindow, instances } = createFakeBrowserWindow({ emitReadyDuringLoad: true });
  const window = await createMainWindow({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: '/app/preload.js',
    indexPath: '/app/index.html'
  });

  assert.equal(window.visible, true);
  assert.equal(instances.length, 1);
  assert.deepEqual(window.events, [
    'once:ready-to-show',
    'loadFile:/app/index.html',
    'show'
  ]);
  assert.equal(window.options.show, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
});

test('main window is shown after loadFile if ready-to-show is missed', async () => {
  const { FakeBrowserWindow } = createFakeBrowserWindow({ emitReadyDuringLoad: false });
  const window = await createMainWindow({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: '/app/preload.js',
    indexPath: '/app/index.html'
  });

  assert.equal(window.visible, true);
  assert.deepEqual(window.events, [
    'once:ready-to-show',
    'loadFile:/app/index.html',
    'show'
  ]);
});
