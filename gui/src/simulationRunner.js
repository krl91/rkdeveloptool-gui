function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSimulationRunner({ emit, delay = sleep }) {
  return async function simulateTool(args, options = {}) {
    const command = args[0];
    emit('log', { line: `$ SIMULATION rkdeveloptool ${args.join(' ')}` });

    if (command === 'ld') {
      return { stdout: 'DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=SIMULATED\tSimulation\n', stderr: '' };
    }

    if (command === 'db') {
      emit('log', { line: 'Simulation: loading Maskrom loader.' });
      await delay(250);
      emit('log', { line: 'Simulation: Maskrom loader OK.' });
      return { stdout: 'Simulation Maskrom loader OK.\n', stderr: '' };
    }

    if (command === 'wl') {
      emit('log', { line: 'Simulation: writing image.' });
      for (const value of [1, 25, 50, 75, 100]) {
        await delay(150);
        emit('progress', { label: options.progressLabel || 'Image', value });
        emit('log', { line: `Simulation Write LBA from file (${value}%)` });
      }
      return { stdout: 'Simulation image OK.\n', stderr: '' };
    }

    if (command === 'rd') {
      emit('log', { line: 'Simulation: reboot command sent.' });
      await delay(150);
      return { stdout: 'Simulation reset OK.\n', stderr: '' };
    }

    throw new Error(`Unsupported simulation command: ${command}`);
  };
}

module.exports = {
  createSimulationRunner
};
