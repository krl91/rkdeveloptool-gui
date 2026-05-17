const childProcess = require('node:child_process');
const path = require('node:path');
const { commandParts, progressFromLine } = require('./lib');

function createToolRunner({ toolPath, config, emit }) {
  return function runTool(args, options = {}) {
    return new Promise((resolve, reject) => {
      const { command, args: fullArgs } = commandParts(toolPath, args, config);
      emit('log', { line: `$ ${[command, ...fullArgs].join(' ')}` });
      const child = childProcess.spawn(command, fullArgs, {
        cwd: path.dirname(toolPath),
        windowsHide: true
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
            emit('progress', { label: options.progressLabel || 'Writing', value: progress });
          }
        }
      };

      child.stdout.on('data', (chunk) => handleChunk(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => handleChunk(chunk, 'stderr'));
      child.on('error', reject);
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
  createToolRunner
};
