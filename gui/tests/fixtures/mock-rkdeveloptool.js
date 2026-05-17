#!/usr/bin/env node
const fs = require('node:fs');

const logPath = process.env.RK_MOCK_LOG;
const mode = process.env.RK_MOCK_MODE || 'one';
const args = process.argv.slice(2);

if (logPath) {
  fs.appendFileSync(logPath, `${args.join(' ')}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(9);
}

if (mode === 'fail') {
  fail('forced mock failure');
}

const command = args[0];

if (command === 'ld') {
  if (mode === 'none') {
    console.log('not found any devices!');
    process.exit(1);
  }
  if (mode === 'many') {
    console.log('DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=141\tMaskrom');
    console.log('DevNo=2\tVid=0x2207,Pid=0x330c,LocationID=142\tLoader');
    process.exit(0);
  }
  console.log('DevNo=1\tVid=0x2207,Pid=0x320a,LocationID=141\tMaskrom');
  process.exit(0);
}

if (command === 'db') {
  if (!args[1]) fail('missing loader');
  console.log('Downloading bootloader...');
  console.log('Downloading bootloader succeeded.');
  process.exit(0);
}

if (command === 'wl') {
  if (!args[1] || !args[2]) fail('missing write arguments');
  console.log('Write LBA from file (1%)');
  console.log('Write LBA from file (50%)');
  console.log('Write LBA from file (100%)');
  process.exit(0);
}

if (command === 'rd') {
  console.log('Reset Device OK.');
  process.exit(0);
}

fail(`unsupported command: ${command || '<empty>'}`);
