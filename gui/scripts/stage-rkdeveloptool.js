const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const guiRoot = path.resolve(__dirname, '..');
const binaryName = process.platform === 'win32' ? 'rkdeveloptool.exe' : 'rkdeveloptool';
const source = path.join(repoRoot, binaryName);
const destinationDir = path.join(guiRoot, 'bin');
const destination = path.join(destinationDir, binaryName);

if (!fs.existsSync(source)) {
  console.error(`Missing ${source}`);
  console.error('Build rkdeveloptool for this OS first, then rerun the GUI packaging command.');
  process.exit(1);
}

fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(source, destination);

if (process.platform !== 'win32') {
  fs.chmodSync(destination, 0o755);
}

console.log(`Staged ${destination}`);
