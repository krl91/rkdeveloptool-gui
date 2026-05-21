const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { isNoDeviceOutput, parseDevices, plannedUpdateKinds, simulatedDevice } = require('../src/lib');
const { createToolRunner, explainRkdeveloptoolFailure, mappedProgressValue } = require('../src/toolRunner');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rk-gui-int-'));
}

function createMockRunner(mode = 'one') {
  const dir = tempDir();
  const logPath = path.join(dir, 'calls.log');
  const events = [];
  const runner = createToolRunner({
    toolPath: path.join(__dirname, 'fixtures', 'mock-rkdeveloptool.js'),
    config: {
      commandPrefix: [process.execPath]
    },
    allowUnsafeCommandPrefix: true,
    emit: (type, payload) => events.push({ type, payload })
  });

  const run = (args, options) => {
    const previousLog = process.env.RK_MOCK_LOG;
    const previousMode = process.env.RK_MOCK_MODE;
    process.env.RK_MOCK_LOG = logPath;
    process.env.RK_MOCK_MODE = mode;
    return runner(args, options).finally(() => {
      if (previousLog === undefined) delete process.env.RK_MOCK_LOG;
      else process.env.RK_MOCK_LOG = previousLog;
      if (previousMode === undefined) delete process.env.RK_MOCK_MODE;
      else process.env.RK_MOCK_MODE = previousMode;
    });
  };

  return {
    events,
    logPath,
    run,
    calls: () => fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      : []
  };
}

test('mock rkdeveloptool ld output is parsed as a single USB device', async () => {
  const mock = createMockRunner('one');
  const result = await mock.run(['ld']);
  const devices = parseDevices(result.stdout);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].vid, '2207');
  assert.equal(devices[0].mode, 'Maskrom');
  assert.deepEqual(mock.calls(), ['ld']);
});

test('mock rkdeveloptool can simulate no USB devices', async () => {
  const mock = createMockRunner('none');
  await assert.rejects(async () => {
    try {
      await mock.run(['ld']);
    } catch (error) {
      assert.equal(isNoDeviceOutput(`${error.stdout}\n${error.message}`), true);
      throw error;
    }
  }, /rkdeveloptool failed/);
  assert.deepEqual(mock.calls(), ['ld']);
  assert.equal(simulatedDevice().mode, 'Simulation');
});

test('integration workflow calls loader before image and forwards progress', async () => {
  const mock = createMockRunner('one');
  const plan = plannedUpdateKinds({ updateLoader: true, updateImage: true });

  for (const kind of plan) {
    if (kind === 'loader') {
      await mock.run(['db', '/tmp/loader.bin'], { progressLabel: 'Loader' });
    }
    if (kind === 'image') {
      await mock.run(['wl', '0', '/tmp/image.img'], { progressLabel: 'Image' });
    }
  }

  assert.deepEqual(mock.calls(), [
    'db /tmp/loader.bin',
    'wl 0 /tmp/image.img'
  ]);

  const progressValues = mock.events
    .filter((event) => event.type === 'progress')
    .map((event) => event.payload);
  assert.deepEqual(progressValues, [
    { label: 'Image', value: 1 },
    { label: 'Image', value: 50 },
    { label: 'Image', value: 100 }
  ]);
});

test('integration workflow sends reboot command after update', async () => {
  const mock = createMockRunner('one');
  await mock.run(['rd']);
  assert.deepEqual(mock.calls(), ['rd']);
});

test('integration runner surfaces rkdeveloptool failures with command output', async () => {
  const mock = createMockRunner('fail');
  await assert.rejects(() => mock.run(['db', '/tmp/loader.bin']), /forced mock failure/);
  assert.deepEqual(mock.calls(), ['db /tmp/loader.bin']);
});

test('integration workflow stops before the image when loader flash fails', async () => {
  const mock = createMockRunner('fail');
  const plan = plannedUpdateKinds({ updateLoader: true, updateImage: true });

  await assert.rejects(async () => {
    for (const kind of plan) {
      if (kind === 'loader') {
        await mock.run(['db', '/tmp/loader.bin'], { progressLabel: 'Loader' });
      }
      if (kind === 'image') {
        await mock.run(['wl', '0', '/tmp/image.img'], { progressLabel: 'Image' });
      }
    }
  }, /forced mock failure/);

  assert.deepEqual(mock.calls(), ['db /tmp/loader.bin']);
});

test('integration runner explains invalid Maskrom loader and image write failures', () => {
  assert.match(
    explainRkdeveloptoolFailure(['db', '/tmp/u-boot.bin'], '\u001b[30;41mOpening loader failed, exiting download boot!\u001b[0m'),
    /Do not use OpenIPC \*_u-boot\.bin files as Maskrom loaders/
  );
  assert.match(
    explainRkdeveloptoolFailure(['db', '/tmp/loader.bin'], 'Downloading bootloader failed!'),
    /could not be sent to the device/
  );
  assert.match(
    explainRkdeveloptoolFailure(['wl', '0', '/tmp/bad.img'], 'Write LBA failed!'),
    /complete OpenIPC \*_sdcard\.img file/
  );
});

test('integration runner explains missing rkdeveloptool executable', async () => {
  const events = [];
  const runner = createToolRunner({
    toolPath: 'rkdeveloptool-not-installed-for-test',
    config: {},
    searchPaths: ['/app/resources/bin/rkdeveloptool', '/app/gui/bin/rkdeveloptool'],
    emit: (type, payload) => events.push({ type, payload })
  });

  await assert.rejects(() => runner(['ld']), /Checked: \/app\/resources\/bin\/rkdeveloptool, \/app\/gui\/bin\/rkdeveloptool; then system PATH command/);
});

test('integration runner maps phase progress to global progress', async () => {
  const mock = createMockRunner('one');
  await mock.run(['wl', '0', '/tmp/image.img'], {
    progressLabel: 'Image 2/2',
    progressOffset: 50,
    progressScale: 0.5
  });

  const progressValues = mock.events
    .filter((event) => event.type === 'progress')
    .map((event) => event.payload);
  assert.deepEqual(progressValues, [
    { label: 'Image 2/2', value: 51 },
    { label: 'Image 2/2', value: 75 },
    { label: 'Image 2/2', value: 100 }
  ]);
});

test('mappedProgressValue clamps progress to the progress bar range', () => {
  assert.equal(mappedProgressValue(50, { progressOffset: 25, progressScale: 0.5 }), 50);
  assert.equal(mappedProgressValue(500, { progressOffset: 0, progressScale: 1 }), 100);
});
