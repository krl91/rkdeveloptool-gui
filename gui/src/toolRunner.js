const childProcess = require('node:child_process');
const path = require('node:path');
const { commandParts, progressFromLine } = require('./lib');

function mappedProgressValue(progress, options = {}) {
  const scale = Number.isFinite(options.progressScale) ? options.progressScale : 1;
  const offset = Number.isFinite(options.progressOffset) ? options.progressOffset : 0;
  return Math.max(0, Math.min(100, Math.round(offset + (progress * scale))));
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function explainRkdeveloptoolFailure(args, detail) {
  const cleanDetail = stripAnsi(detail).trim();
  const command = args[0];

  if (command === 'db' && /Opening loader failed/i.test(cleanDetail)) {
    return [
      'The selected Maskrom loader could not be opened by rkdeveloptool.',
      'Choose one of the Radxa RK356x SPL loaders from the list, or select a valid Rockchip loader manually.',
      'Do not use OpenIPC *_u-boot.bin files as Maskrom loaders.',
      cleanDetail
    ].join('\n');
  }

  if (command === 'db' && /Downloading bootloader failed/i.test(cleanDetail)) {
    return [
      'The Maskrom loader was accepted but could not be sent to the device.',
      'Re-enter Maskrom mode, try another Radxa RK356x SPL loader, and avoid USB hubs.',
      cleanDetail
    ].join('\n');
  }

  if (command === 'wl' && /Write LBA failed/i.test(cleanDetail)) {
    return [
      'The image could not be written to the device.',
      'Make sure the Maskrom loader was loaded successfully first, then retry with a complete OpenIPC *_sdcard.img file.',
      cleanDetail
    ].join('\n');
  }

  return cleanDetail;
}

function createToolRunner({ toolPath, config, searchPaths = [], emit, allowUnsafeCommandPrefix = false }) {
  return function runTool(args, options = {}) {
    return new Promise((resolve, reject) => {
      const { command, args: fullArgs } = commandParts(toolPath, args, config, { allowUnsafeCommandPrefix });
      emit('log', { line: `$ ${[command, ...fullArgs].join(' ')}` });
      const child = childProcess.spawn(command, fullArgs, {
        cwd: path.dirname(toolPath),
        windowsHide: true,
        shell: false
      });

      let stdout = '';
      let stderr = '';
      const handleChunk = (chunk, streamName) => {
        const text = chunk.toString();
        if (streamName === 'stdout') stdout += text;
        else stderr += text;
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          emit('log', { line });
          const progress = progressFromLine(line);
          if (progress !== null) {
            emit('progress', { label: options.progressLabel || 'Writing', value: mappedProgressValue(progress, options) });
          }
        }
      };

      child.stdout.on('data', (chunk) => handleChunk(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => handleChunk(chunk, 'stderr'));
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          const checked = searchPaths.length > 0 ? searchPaths.join(', ') : 'packaged resources, development bundle, repository root';
          reject(new Error(`rkdeveloptool executable was not found. Checked: ${checked}; then system PATH command: ${toolPath}`));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const detail = (stderr || stdout || '').trim();
          const explained = explainRkdeveloptoolFailure(args, detail);
          const error = new Error(`rkdeveloptool failed with code ${code}${explained ? `: ${explained}` : ''}`);
          error.code = code;
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        }
      });
    });
  };
}

module.exports = {
  createToolRunner,
  explainRkdeveloptoolFailure,
  mappedProgressValue
};
