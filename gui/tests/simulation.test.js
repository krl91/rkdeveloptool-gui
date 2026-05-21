const assert = require('node:assert/strict');
const test = require('node:test');

const { parseDevices } = require('../src/lib');
const { createSimulationRunner } = require('../src/simulationRunner');

function createRunner() {
  const events = [];
  const runner = createSimulationRunner({
    emit: (type, payload) => events.push({ type, payload }),
    delay: () => Promise.resolve()
  });
  return { events, runner };
}

test('simulation ld returns a simulated Rockusb device without real hardware', async () => {
  const { events, runner } = createRunner();
  const result = await runner(['ld']);
  const devices = parseDevices(result.stdout);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].locationId, 'SIMULATED');
  assert.equal(devices[0].mode, 'Simulation');
  assert.equal(events[0].payload.line, '$ SIMULATION rkdeveloptool ld');
});

test('simulation db/wl/rd completes without invoking the real rkdeveloptool', async () => {
  const { events, runner } = createRunner();

  await runner(['db', '/tmp/loader.bin'], { progressLabel: 'Loader' });
  await runner(['wl', '0', '/tmp/image.img'], { progressLabel: 'Image' });
  await runner(['rd']);

  const commandLines = events
    .filter((event) => event.type === 'log' && event.payload.line.startsWith('$ SIMULATION'))
    .map((event) => event.payload.line);

  assert.deepEqual(commandLines, [
    '$ SIMULATION rkdeveloptool db /tmp/loader.bin',
    '$ SIMULATION rkdeveloptool wl 0 /tmp/image.img',
    '$ SIMULATION rkdeveloptool rd'
  ]);

  const progressValues = events
    .filter((event) => event.type === 'progress')
    .map((event) => event.payload);

  assert.deepEqual(progressValues, [
    { label: 'Loader', value: 1 },
    { label: 'Loader', value: 25 },
    { label: 'Loader', value: 50 },
    { label: 'Loader', value: 75 },
    { label: 'Loader', value: 100 },
    { label: 'Image', value: 1 },
    { label: 'Image', value: 25 },
    { label: 'Image', value: 50 },
    { label: 'Image', value: 75 },
    { label: 'Image', value: 100 }
  ]);
});

test('simulation loader progress respects the assigned global progress range', async () => {
  const { events, runner } = createRunner();

  await runner(['db', '/tmp/loader.bin'], {
    progressLabel: 'Maskrom loader 1/2',
    progressOffset: 25,
    progressScale: 0.25
  });

  const progressValues = events
    .filter((event) => event.type === 'progress')
    .map((event) => event.payload);

  assert.deepEqual(progressValues, [
    { label: 'Maskrom loader 1/2', value: 25 },
    { label: 'Maskrom loader 1/2', value: 31 },
    { label: 'Maskrom loader 1/2', value: 38 },
    { label: 'Maskrom loader 1/2', value: 44 },
    { label: 'Maskrom loader 1/2', value: 50 }
  ]);
});

test('simulation write progress respects the assigned global progress range', async () => {
  const { events, runner } = createRunner();

  await runner(['wl', '0', '/tmp/image.img'], {
    progressLabel: 'Image 2/2',
    progressOffset: 75,
    progressScale: 0.25
  });

  const progressValues = events
    .filter((event) => event.type === 'progress')
    .map((event) => event.payload);

  assert.deepEqual(progressValues, [
    { label: 'Image 2/2', value: 75 },
    { label: 'Image 2/2', value: 81 },
    { label: 'Image 2/2', value: 88 },
    { label: 'Image 2/2', value: 94 },
    { label: 'Image 2/2', value: 100 }
  ]);
});

test('simulation rejects unsupported commands clearly', async () => {
  const { runner } = createRunner();
  await assert.rejects(() => runner(['ef']), /Unsupported simulation command: ef/);
});
