function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDelayMs(value, fallback = 2000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return number;
}

function createCommandSequencer({
  getDelayMs = () => 2000,
  now = () => Date.now(),
  delay = sleep
} = {}) {
  let lastFinishedAt = 0;
  let queue = Promise.resolve();

  async function waitBeforeNextCommand() {
    const delayMs = normalizeDelayMs(getDelayMs(), 2000);
    if (!lastFinishedAt || delayMs === 0) {
      return;
    }

    const elapsed = Math.max(0, now() - lastFinishedAt);
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      await delay(remaining);
    }
  }

  function run(task) {
    const next = queue.then(async () => {
      await waitBeforeNextCommand();
      try {
        return await task();
      } finally {
        lastFinishedAt = now();
      }
    });
    queue = next.catch(() => {});
    return next;
  }

  return { run };
}

module.exports = {
  createCommandSequencer,
  normalizeDelayMs
};
