const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  commandParts,
  deepMerge,
  describeUpdatePlan,
  digestFromAsset,
  executableName,
  findChecksumAsset,
  findMatchingAsset,
  findRkdeveloptool,
  findRkdeveloptoolWithDiagnostics,
  githubApiFromReleasePage,
  isNoDeviceOutput,
  isSimulatedDevice,
  loadConfigFiles,
  loadConfigFilesWithSources,
  normalizeLocalPath,
  normalizeFileKind,
  normalizeTimeoutMs,
  normalizeUpdateOptions,
  parseChecksumText,
  parseDevices,
  plannedUpdateKinds,
  progressFromLine,
  publicConfig,
  readJson,
  resolveSha256FromRelease,
  shouldHashLocalFile,
  sourceSummary,
  validateCommandPrefix,
  validateLocalPathSelection,
  sha256File
} = require('../src/lib');

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('deepMerge merges nested objects without mutating the base config', () => {
  const base = {
    loader: { url: 'old', assetName: 'loader.bin' },
    image: { lba: 0 },
    commandPrefix: ['sudo']
  };
  const merged = deepMerge(base, {
    loader: { url: 'new' },
    commandPrefix: []
  });

  assert.deepEqual(merged, {
    loader: { url: 'new', assetName: 'loader.bin' },
    image: { lba: 0 },
    commandPrefix: []
  });
  assert.equal(base.loader.url, 'old');
  assert.deepEqual(base.commandPrefix, ['sudo']);
});

test('loadConfigFiles applies overrides in declaration order', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-config-'));
  const defaults = path.join(tmp, 'default.json');
  const first = path.join(tmp, 'first.json');
  const second = path.join(tmp, 'second.json');

  fs.writeFileSync(defaults, JSON.stringify({
    loader: { url: 'default', assetName: 'loader.bin' },
    image: { lba: 0 }
  }));
  fs.writeFileSync(first, JSON.stringify({ loader: { url: 'first' } }));
  fs.writeFileSync(second, JSON.stringify({ image: { lba: 2048 } }));

  const config = loadConfigFiles(defaults, [first, path.join(tmp, 'missing.json'), second]);
  assert.equal(config.loader.url, 'first');
  assert.equal(config.loader.assetName, 'loader.bin');
  assert.equal(config.image.lba, 2048);
});

test('loadConfigFilesWithSources reports applied override files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-config-sources-'));
  const defaults = path.join(tmp, 'default.json');
  const override = path.join(tmp, 'override.json');
  const missing = path.join(tmp, 'missing.json');

  fs.writeFileSync(defaults, JSON.stringify({ loader: { url: 'default' } }));
  fs.writeFileSync(override, JSON.stringify({ loader: { url: 'custom' } }));

  const loaded = loadConfigFilesWithSources(defaults, [missing, override]);
  assert.equal(loaded.config.loader.url, 'custom');
  assert.equal(loaded.defaultConfigPath, defaults);
  assert.deepEqual(loaded.overrides, [override]);
});

test('executableName selects the expected filename per platform', () => {
  assert.equal(executableName('win32'), 'rkdeveloptool.exe');
  assert.equal(executableName('darwin'), 'rkdeveloptool');
  assert.equal(executableName('linux'), 'rkdeveloptool');
});

test('findRkdeveloptool prefers explicit path, then packaged resources', () => {
  const packagedTool = path.join('/resources', 'bin', 'rkdeveloptool');
  const fakeFs = {
    existsSync: (candidate) => candidate === packagedTool
  };

  assert.equal(findRkdeveloptool({ rkdeveloptoolPath: '/custom/tool' }), '/custom/tool');
  assert.equal(findRkdeveloptool({}, {
    fsModule: fakeFs,
    platform: 'darwin',
    resourcesPath: '/resources',
    guiRoot: '/gui',
    repoRoot: '/repo',
    cwd: '/cwd'
  }), packagedTool);
});

test('findRkdeveloptool falls back to PATH executable name', () => {
  const fakeFs = { existsSync: () => false };
  assert.equal(findRkdeveloptool({}, {
    fsModule: fakeFs,
    platform: 'win32',
    resourcesPath: '/resources',
    guiRoot: '/gui',
    repoRoot: '/repo',
    cwd: '/cwd'
  }), 'rkdeveloptool.exe');
});

test('findRkdeveloptoolWithDiagnostics reports searched paths and PATH fallback', () => {
  const fakeFs = { existsSync: () => false };
  const result = findRkdeveloptoolWithDiagnostics({}, {
    fsModule: fakeFs,
    platform: 'linux',
    resourcesPath: '/resources',
    guiRoot: '/gui',
    repoRoot: '/repo',
    cwd: '/cwd'
  });

  assert.equal(result.path, 'rkdeveloptool');
  assert.equal(result.usesPathFallback, true);
  assert.deepEqual(result.searchPaths, [
    path.join('/resources', 'bin', 'rkdeveloptool'),
    path.join('/gui', 'bin', 'rkdeveloptool'),
    path.join('/repo', 'rkdeveloptool'),
    path.join('/cwd', 'rkdeveloptool')
  ]);
});

test('commandParts supports direct commands and privilege prefixes', () => {
  assert.deepEqual(commandParts('/bin/rkdeveloptool', ['ld'], {}), {
    command: '/bin/rkdeveloptool',
    args: ['ld']
  });
  assert.deepEqual(commandParts('/bin/rkdeveloptool', ['rd'], { commandPrefix: ['sudo', '-n'] }), {
    command: 'sudo',
    args: ['-n', '/bin/rkdeveloptool', 'rd']
  });
});

test('commandParts rejects unsafe command prefixes by default', () => {
  assert.throws(() => commandParts('/bin/rkdeveloptool', ['ld'], {
    commandPrefix: ['/bin/sh', '-c']
  }), /Unsupported commandPrefix executable/);
  assert.throws(() => commandParts('/bin/rkdeveloptool', ['ld'], {
    commandPrefix: ['sudo', '-E']
  }), /Unsupported commandPrefix argument/);
  assert.deepEqual(validateCommandPrefix(['pkexec']), ['pkexec']);
});

test('parseDevices reads rkdeveloptool ld output and ignores unrelated lines', () => {
  const devices = parseDevices([
    'noise',
    'DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=141\tMaskrom',
    'DevNo=2\tVid=0x2207,Pid=0x330c,LocationID=142\tLoader'
  ].join('\n'));

  assert.deepEqual(devices, [
    {
      devNo: 1,
      vid: '2207',
      pid: '320a',
      locationId: '141',
      mode: 'Maskrom',
      raw: 'DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=141\tMaskrom'
    },
    {
      devNo: 2,
      vid: '2207',
      pid: '330c',
      locationId: '142',
      mode: 'Loader',
      raw: 'DevNo=2\tVid=0x2207,Pid=0x330c,LocationID=142\tLoader'
    }
  ]);
});

test('parseDevices supports LocationID variants seen across rkdeveloptool builds', () => {
  const devices = parseDevices([
    'DevNo=1 Vid=0x2207,Pid=0x330c,LocationID=1-2:1.0 Loader',
    'DevNo=2 Vid=0x2207,Pid=0x320a,LocationID=usb-3.4 Maskrom'
  ].join('\n'));

  assert.deepEqual(devices.map((device) => ({
    devNo: device.devNo,
    locationId: device.locationId,
    mode: device.mode
  })), [
    { devNo: 1, locationId: '1-2:1.0', mode: 'Loader' },
    { devNo: 2, locationId: 'usb-3.4', mode: 'Maskrom' }
  ]);
});

test('isNoDeviceOutput recognizes rkdeveloptool ld no-device output', () => {
  assert.equal(isNoDeviceOutput('not found any devices!'), true);
  assert.equal(isNoDeviceOutput('NOT FOUND ANY DEVICES!'), true);
  assert.equal(isNoDeviceOutput('No devices found'), true);
  assert.equal(isNoDeviceOutput('Did not find any rockusb device, please plug device in!'), true);
  assert.equal(isNoDeviceOutput('Found too many rockusb devices'), false);
});

test('simulatedDevice is recognized as simulation-only', () => {
  assert.equal(isSimulatedDevice({ locationId: 'SIMULATED', mode: 'Simulation' }), true);
  assert.equal(isSimulatedDevice({ locationId: '141', mode: 'Maskrom' }), false);
  assert.equal(isSimulatedDevice(null), false);
});

test('progressFromLine extracts rkdeveloptool progress percentages', () => {
  assert.equal(progressFromLine('Write LBA from file (87%)'), 87);
  assert.equal(progressFromLine('Downloading bootloader...'), null);
});

test('githubApiFromReleasePage converts a GitHub release page to the API endpoint', () => {
  assert.equal(
    githubApiFromReleasePage('https://github.com/OpenIPC/sbc-groundstations/releases/tag/buildroot-snapshot'),
    'https://api.github.com/repos/OpenIPC/sbc-groundstations/releases/tags/buildroot-snapshot'
  );
  assert.equal(githubApiFromReleasePage('https://example.com/release'), '');
});

test('parseChecksumText supports common checksum file formats', () => {
  assert.equal(parseChecksumText(`${SHA_A}  runcam_wifilink_sdcard.img`, 'runcam_wifilink_sdcard.img'), SHA_A);
  assert.equal(parseChecksumText(`${SHA_B} *runcam_wifilink_u-boot.bin`, 'runcam_wifilink_u-boot.bin'), SHA_B);
  assert.equal(parseChecksumText(`runcam_wifilink_sdcard.img ${SHA_A}`, 'runcam_wifilink_sdcard.img'), SHA_A);
  assert.equal(parseChecksumText(`${SHA_A} other.img`, 'missing.img'), '');
});

test('release asset helpers select assets and SHA256 sources deterministically', () => {
  const imageAsset = {
    name: 'runcam_wifilink_sdcard.img',
    browser_download_url: 'https://github.com/repo/releases/download/tag/runcam_wifilink_sdcard.img',
    digest: `sha256:${SHA_A.toUpperCase()}`
  };
  const checksumAsset = {
    name: 'SHA256SUMS',
    browser_download_url: 'https://github.com/repo/releases/download/tag/SHA256SUMS'
  };
  const assets = [checksumAsset, imageAsset];

  assert.equal(findMatchingAsset(assets, { assetName: 'runcam_wifilink_sdcard.img' }), imageAsset);
  assert.equal(findMatchingAsset(assets, { assetName: 'x', url: imageAsset.browser_download_url }), imageAsset);
  assert.equal(findMatchingAsset(assets, { assetName: 'x', url: 'none' }), undefined);
  assert.equal(findChecksumAsset(assets), checksumAsset);
  assert.equal(digestFromAsset(imageAsset), SHA_A);
});

test('resolveSha256FromRelease falls back from GitHub digest to checksum text and body', () => {
  const asset = { name: 'image.img', digest: '' };
  assert.equal(resolveSha256FromRelease({}, { ...asset, digest: `sha256:${SHA_A}` }), SHA_A);
  assert.equal(resolveSha256FromRelease({}, asset, `${SHA_B} image.img`), SHA_B);
  assert.equal(resolveSha256FromRelease({ body: `${SHA_A} image.img` }, asset), SHA_A);
  assert.equal(resolveSha256FromRelease({ body: '' }, asset), '');
  assert.equal(resolveSha256FromRelease({}, asset), '');
});

test('plannedUpdateKinds always schedules loader before image', () => {
  assert.deepEqual(plannedUpdateKinds({ updateLoader: true, updateImage: true }), ['loader', 'image']);
  assert.deepEqual(plannedUpdateKinds({ updateLoader: false, updateImage: true }), ['image']);
  assert.throws(() => plannedUpdateKinds({ updateLoader: false, updateImage: false }), /Select/);
});

test('normalizeUpdateOptions validates renderer-provided update options', () => {
  assert.deepEqual(normalizeUpdateOptions({
    updateLoader: true,
    updateImage: false,
    loaderSource: 'local',
    imageSource: 'online',
    loaderPath: '/tmp/loader.bin',
    imagePath: 42
  }), {
    updateLoader: true,
    updateImage: false,
    loaderSource: 'local',
    imageSource: 'online',
    loaderPath: '/tmp/loader.bin',
    imagePath: ''
  });

  assert.throws(() => normalizeUpdateOptions(null), /Invalid update options/);
  assert.throws(() => normalizeUpdateOptions({
    updateLoader: 'yes',
    updateImage: false,
    loaderSource: 'online',
    imageSource: 'online'
  }), /Invalid updateLoader/);
  assert.throws(() => normalizeUpdateOptions({
    updateLoader: true,
    updateImage: false,
    loaderSource: 'remote',
    imageSource: 'online'
  }), /Unsupported loaderSource/);
});

test('normalizeFileKind only accepts known firmware file kinds', () => {
  assert.equal(normalizeFileKind('loader'), 'loader');
  assert.equal(normalizeFileKind('image'), 'image');
  assert.throws(() => normalizeFileKind('config'), /Unsupported file kind/);
});

test('describeUpdatePlan explains exactly what will happen before flashing', () => {
  assert.deepEqual(describeUpdatePlan({
    updateLoader: true,
    updateImage: true,
    loaderSource: 'online',
    imageSource: 'local'
  }), [
    '1. Update the loader from the latest online file',
    '2. Write the image from the local file'
  ]);
});

test('local file paths must come from the file picker allow-list', () => {
  const selected = normalizeLocalPath('/tmp/loader.bin');
  const allowed = new Set([selected]);

  assert.equal(validateLocalPathSelection('loader', '/tmp/loader.bin', allowed), '/tmp/loader.bin');
  assert.throws(() => validateLocalPathSelection('loader', '', allowed), /No local file selected/);
  assert.throws(() => validateLocalPathSelection('image', '/tmp/other.img', allowed), /file picker/);
});

test('simulation mode skips local file hashing to avoid blocking on large images', () => {
  assert.equal(shouldHashLocalFile({ simulation: true }), false);
  assert.equal(shouldHashLocalFile({ simulation: false }), true);
  assert.equal(shouldHashLocalFile(), true);
});

test('publicConfig only exposes renderer-visible values', () => {
  assert.deepEqual(publicConfig({
    rkdeveloptoolPath: '/secret/tool',
    commandPrefix: ['sudo', '-n'],
    loader: { url: 'https://loader.example/file.bin', assetName: 'loader.bin' },
    image: { url: 'https://image.example/file.img', assetName: 'image.img', lba: 0 }
  }), {
    loader: { url: 'https://loader.example/file.bin' },
    image: { url: 'https://image.example/file.img', lba: 0 }
  });
});

test('sourceSummary extracts configured source hosts for confirmation UI', () => {
  assert.deepEqual(sourceSummary({
    releaseApiUrl: 'https://api.github.com/repos/OpenIPC/sbc-groundstations/releases/tags/buildroot-snapshot',
    loader: { url: 'https://github.com/OpenIPC/sbc-groundstations/releases/download/tag/loader.bin' },
    image: { url: 'https://mirror.example/images/sdcard.img' }
  }), {
    releaseApiHost: 'api.github.com',
    loaderHost: 'github.com',
    imageHost: 'mirror.example'
  });
});

test('normalizeTimeoutMs keeps large configurable values and rejects invalid ones', () => {
  assert.equal(normalizeTimeoutMs(7200000, 300000), 7200000);
  assert.equal(normalizeTimeoutMs('60000', 300000), 60000);
  assert.equal(normalizeTimeoutMs(-1, 300000), 300000);
  assert.equal(normalizeTimeoutMs('bad', 300000), 300000);
});

test('default config keeps network timeouts configurable and large', () => {
  const config = readJson(path.join(__dirname, '..', 'config', 'default.json'));
  assert.equal(config.network.metadataTimeoutMs, 300000);
  assert.equal(config.network.downloadTimeoutMs, 7200000);
});

test('sha256File returns the expected digest for local firmware files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-sha-'));
  const filePath = path.join(tmp, 'firmware.bin');
  fs.writeFileSync(filePath, 'abc');

  assert.equal(
    await sha256File(filePath),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});
