const { isNoDeviceOutput, parseDevices, simulatedDevice } = require('./lib');

async function detectDevices(runTool) {
  try {
    const result = await runTool(['ld']);
    return parseDevices(result.stdout || '');
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    if (isNoDeviceOutput(output)) {
      return [];
    }
    throw error;
  }
}

function deviceNeedsLoaderBeforeImage(device) {
  return /maskrom/i.test(String(device?.mode || ''));
}

async function ensureDevicePresentBeforeFlash({
  actionLabel = 'flash',
  runTool,
  chooseNoDeviceAction,
  setDevice,
  emit = () => {}
}) {
  while (true) {
    emit('status', { message: `Checking device before ${actionLabel}...` });
    const devices = await detectDevices(runTool);

    if (devices.length === 1) {
      setDevice(devices[0], false);
      return devices[0];
    }

    if (devices.length > 1) {
      throw new Error('Multiple Rockusb devices were detected. Keep only one device connected, then try again.');
    }

    emit('status', { message: 'No Rockusb device detected.' });
    const choice = await chooseNoDeviceAction();

    if (choice === 'try-again') {
      continue;
    }

    if (choice === 'simulate') {
      const device = simulatedDevice();
      setDevice(device, true);
      emit('log', { line: 'Simulation mode: no real device will be flashed.' });
      return device;
    }

    throw new Error('No Rockusb device detected. Update canceled.');
  }
}

module.exports = {
  detectDevices,
  deviceNeedsLoaderBeforeImage,
  ensureDevicePresentBeforeFlash
};
