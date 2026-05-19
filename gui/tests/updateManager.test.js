const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  checkForAppUpdate,
  downloadUpdateAsset,
  installCommand,
  installUpdate
} = require('../src/updateManager');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function streamFrom(chunks) {
  let index = 0;
  return {
    getReader() {
      return {
        async read() {
          if (index >= chunks.length) return { done: true };
          const value = chunks[index];
          index += 1;
          return { done: false, value };
        }
      };
    }
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

function binaryResponse(buffer, contentLength = buffer.length) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => name.toLowerCase() === 'content-length' ? String(contentLength) : ''
    },
    body: streamFrom([buffer])
  };
}

test('application update check reports no update when latest version matches current version', async () => {
  const result = await checkForAppUpdate({
    enabled: true,
    isOnline: true,
    currentVersion: '0.1.2',
    releaseApiUrl: 'https://api.github.com/repos/krl91/rkdeveloptool-gui/releases/latest',
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async () => jsonResponse({
      tag_name: 'v0.1.2',
      assets: []
    }),
    timeoutMs: 1000
  });

  assert.equal(result.checked, true);
  assert.equal(result.available, false);
});

test('application update check selects the matching asset when a newer version exists', async () => {
  const result = await checkForAppUpdate({
    enabled: true,
    isOnline: true,
    currentVersion: '0.1.2',
    releaseApiUrl: 'https://api.github.com/repos/krl91/rkdeveloptool-gui/releases/latest',
    platform: 'linux',
    arch: 'x64',
    linuxPackage: 'deb',
    fetchImpl: async () => jsonResponse({
      tag_name: 'v0.1.3',
      assets: [
        { name: 'RK.Firmware.Updater-0.1.3-arm64.deb' },
        { name: 'RK.Firmware.Updater-0.1.3-amd64.deb' }
      ]
    }),
    timeoutMs: 1000
  });

  assert.equal(result.available, true);
  assert.equal(result.latestVersion, '0.1.3');
  assert.equal(result.asset.name, 'RK.Firmware.Updater-0.1.3-amd64.deb');
});

test('application update installation runs the selected installer command', async () => {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => child.emit('close', 0));
    return child;
  };

  await installUpdate('/tmp/RK.Firmware.Updater-0.1.3-amd64.deb', {
    platform: 'linux',
    spawnImpl,
    timeoutMs: 1000
  });

  assert.deepEqual(calls, [{
    command: 'pkexec',
    args: ['apt', 'install', '-y', '/tmp/RK.Firmware.Updater-0.1.3-amd64.deb']
  }]);
  assert.deepEqual(installCommand('C:\\tmp\\RK.Firmware.Updater.Setup.0.1.3.exe', { platform: 'win32' }), {
    command: 'C:\\tmp\\RK.Firmware.Updater.Setup.0.1.3.exe',
    args: []
  });
});

test('partial application update download rolls back and does not leave an installer', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-app-update-partial-'));
  const asset = {
    name: 'RK.Firmware.Updater-0.1.3-amd64.deb',
    browser_download_url: 'https://example.com/update.deb',
    digest: `sha256:${sha256(Buffer.from('complete'))}`
  };

  await assert.rejects(() => downloadUpdateAsset(asset, {
    downloadDir: tmp,
    fetchImpl: async () => binaryResponse(Buffer.from('part'), 10),
    timeoutMs: 1000
  }), /Incomplete update download/);

  assert.equal(fs.existsSync(path.join(tmp, asset.name)), false);
  assert.equal(fs.existsSync(path.join(tmp, `${asset.name}.download`)), false);
});

test('offline application launch skips the update network request', async () => {
  let called = false;
  const result = await checkForAppUpdate({
    enabled: true,
    isOnline: false,
    currentVersion: '0.1.2',
    releaseApiUrl: 'https://api.github.com/repos/krl91/rkdeveloptool-gui/releases/latest',
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
    timeoutMs: 1
  });

  assert.equal(called, false);
  assert.equal(result.reason, 'offline');
});

test('application update download timeout aborts the request', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-app-update-timeout-'));
  const asset = {
    name: 'RK.Firmware.Updater-0.1.3-amd64.deb',
    browser_download_url: 'https://example.com/update.deb'
  };

  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  await assert.rejects(() => downloadUpdateAsset(asset, {
    downloadDir: tmp,
    fetchImpl,
    timeoutMs: 5
  }), /timed out/);
});

test('application update install timeout fails without reporting success', async () => {
  const child = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };

  await assert.rejects(() => installUpdate('/tmp/RK.Firmware.Updater-0.1.3-amd64.deb', {
    platform: 'linux',
    spawnImpl: () => child,
    timeoutMs: 5
  }), /installer timed out/);

  assert.equal(child.killed, true);
});
