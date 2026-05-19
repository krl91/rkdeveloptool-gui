const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCommandSequencer,
  normalizeDelayMs
} = require('../src/commandDelay');

test('command sequencer waits at least the configured delay between rkdeveloptool commands', async () => {
  let currentTime = 1000;
  const sleeps = [];
  const calls = [];
  const sequencer = createCommandSequencer({
    getDelayMs: () => 2000,
    now: () => currentTime,
    delay: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    }
  });

  await sequencer.run(async () => {
    calls.push('ld');
    currentTime += 100;
  });
  await sequencer.run(async () => {
    calls.push('db');
    currentTime += 100;
  });

  assert.deepEqual(calls, ['ld', 'db']);
  assert.deepEqual(sleeps, [2000]);
});

test('command sequencer only waits for the remaining configured delay', async () => {
  let currentTime = 1000;
  const sleeps = [];
  const sequencer = createCommandSequencer({
    getDelayMs: () => 2000,
    now: () => currentTime,
    delay: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    }
  });

  await sequencer.run(async () => {
    currentTime += 100;
  });
  currentTime += 750;
  await sequencer.run(async () => {
    currentTime += 100;
  });

  assert.deepEqual(sleeps, [1250]);
});

test('command sequencer continues after a failed rkdeveloptool command', async () => {
  let currentTime = 1000;
  const calls = [];
  const sleeps = [];
  const sequencer = createCommandSequencer({
    getDelayMs: () => 2000,
    now: () => currentTime,
    delay: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    }
  });

  await assert.rejects(() => sequencer.run(async () => {
    calls.push('db');
    currentTime += 100;
    throw new Error('loader failed');
  }), /loader failed/);

  await sequencer.run(async () => {
    calls.push('ld');
    currentTime += 100;
  });

  assert.deepEqual(calls, ['db', 'ld']);
  assert.deepEqual(sleeps, [2000]);
});

test('normalizeDelayMs keeps valid delays and rejects invalid values', () => {
  assert.equal(normalizeDelayMs(0), 0);
  assert.equal(normalizeDelayMs(2000), 2000);
  assert.equal(normalizeDelayMs('3000'), 3000);
  assert.equal(normalizeDelayMs(-1), 2000);
  assert.equal(normalizeDelayMs('bad'), 2000);
});
