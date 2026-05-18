const childProcess = require('node:child_process');
const path = require('node:path');
const { commandParts, progressFromLine } = require('./lib');

function mappedProgressValue(progress, options = {}) {
  const scale = Number.isFinite(options.progressScale) ? options.progressScale : 1;
  const offset = Number.isFinite(options.progressOffset) ? options.progressOffset : 0;
  return Math.max(0, Math.min(100, Math.round(offset + (progress * scale))));
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
          const error = new Error(`rkdeveloptool failed with code ${code}${detail ? `: ${detail}` : ''}`);
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
  mappedProgressValue
};
