const assert = require('node:assert/strict');
const test = require('node:test');

const { detectDevices, ensureDevicePresentBeforeFlash } = require('../src/devicePresence');

const DEVICE_LINE = 'DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=141\tMaskrom';

test('detectDevices treats rkdeveloptool no-device output as an empty device list', async () => {
  const runTool = async () => {
    const error = new Error('rkdeveloptool failed with code 1: not found any devices!');
    error.stderr = 'not found any devices!';
    throw error;
  };

  assert.deepEqual(await detectDevices(runTool), []);
});

test('ensureDevicePresentBeforeFlash checks ld before flashing and retries after the device appears', async () => {
  const calls = [];
  const choices = ['try-again'];
  const devices = [];
  const events = [];

  const device = await ensureDevicePresentBeforeFlash({
    actionLabel: 'writing loader',
    runTool: async (args) => {
      calls.push(args.join(' '));
      if (calls.length === 1) {
        const error = new Error('not found any devices!');
        error.stderr = 'not found any devices!';
        throw error;
      }
      return { stdout: `${DEVICE_LINE}\n`, stderr: '' };
    },
    chooseNoDeviceAction: async () => choices.shift(),
    setDevice: (nextDevice, simulation) => devices.push({ nextDevice, simulation }),
    emit: (type, payload) => events.push({ type, payload })
  });

  assert.equal(device.mode, 'Maskrom');
  assert.deepEqual(calls, ['ld', 'ld']);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].simulation, false);
  assert.equal(events.some((event) => event.type === 'status' && /No Rockusb device detected/.test(event.payload.message)), true);
});

test('ensureDevicePresentBeforeFlash can switch to simulation instead of flashing a missing device', async () => {
  const devices = [];
  const events = [];

  const device = await ensureDevicePresentBeforeFlash({
    runTool: async () => {
      const error = new Error('No devices found');
      error.stderr = 'No devices found';
      throw error;
    },
    chooseNoDeviceAction: async () => 'simulate',
    setDevice: (nextDevice, simulation) => devices.push({ nextDevice, simulation }),
    emit: (type, payload) => events.push({ type, payload })
  });

  assert.equal(device.locationId, 'SIMULATED');
  assert.deepEqual(devices.map((entry) => entry.simulation), [true]);
  assert.equal(events.some((event) => event.type === 'log' && /Simulation mode/.test(event.payload.line)), true);
});

test('ensureDevicePresentBeforeFlash cancels when the user closes the no-device screen', async () => {
  await assert.rejects(() => ensureDevicePresentBeforeFlash({
    runTool: async () => {
      const error = new Error('not found any devices!');
      error.stderr = 'not found any devices!';
      throw error;
    },
    chooseNoDeviceAction: async () => 'close',
    setDevice: () => {}
  }), /Update canceled/);
});
