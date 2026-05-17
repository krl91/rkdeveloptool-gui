const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALID_FILE_KINDS = new Set(['loader', 'image']);
const VALID_SOURCES = new Set(['online', 'local']);

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function readJson(filePath, fsModule = fs) {
  return JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
}

function loadConfigFiles(defaultConfigPath, candidates, fsModule = fs) {
  let config = readJson(defaultConfigPath, fsModule);
  for (const candidate of candidates.filter(Boolean)) {
    if (fsModule.existsSync(candidate)) {
      config = deepMerge(config, readJson(candidate, fsModule));
    }
  }
  return config;
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'rkdeveloptool.exe' : 'rkdeveloptool';
}

function findRkdeveloptool(config, options = {}) {
  if (config.rkdeveloptoolPath) {
    return config.rkdeveloptoolPath;
  }

  const fsModule = options.fsModule || fs;
  const name = executableName(options.platform);
  const candidates = [
    path.join(options.resourcesPath || '', 'bin', name),
    path.join(options.guiRoot || '', 'bin', name),
    path.join(options.repoRoot || '', name),
    path.join(options.cwd || process.cwd(), name)
  ].filter((candidate) => candidate !== path.join('bin', name));

  for (const candidate of candidates) {
    if (fsModule.existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

function commandParts(toolPath, args, config = {}) {
  const prefix = Array.isArray(config.commandPrefix) ? config.commandPrefix : [];
  if (prefix.length > 0) {
    return { command: prefix[0], args: [...prefix.slice(1), toolPath, ...args] };
  }
  return { command: toolPath, args };
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/DevNo=(\d+)\s+Vid=0x([0-9a-fA-F]+),Pid=0x([0-9a-fA-F]+),LocationID=([0-9a-zA-Z]+)\s+(.+)/);
      if (!match) return null;
      return {
        devNo: Number(match[1]),
        vid: match[2],
        pid: match[3],
        locationId: match[4],
        mode: match[5].trim(),
        raw: line.trim()
      };
    })
    .filter(Boolean);
}

function progressFromLine(line) {
  const match = String(line).match(/\((\d+)%\)/);
  return match ? Number(match[1]) : null;
}

function githubApiFromReleasePage(url) {
  const match = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/);
  if (!match) return '';
  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/tags/${match[3]}`;
}

function parseChecksumText(text, assetName) {
  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\b([a-fA-F0-9]{64})\\b\\s+[* ]?${escapedName}\\b`),
    new RegExp(`${escapedName}\\b\\s+\\b([a-fA-F0-9]{64})\\b`)
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (match) return match[1].toLowerCase();
  }
  return '';
}

function findMatchingAsset(assets, item) {
  return assets.find((entry) =>
    entry.name === item.assetName ||
    entry.browser_download_url === item.url ||
    entry.browser_download_url?.endsWith(`/${item.assetName}`)
  );
}

function digestFromAsset(asset) {
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
    return asset.digest.slice('sha256:'.length).toLowerCase();
  }
  return '';
}

function findChecksumAsset(assets) {
  return assets.find((entry) => /sha256|checksum|sums/i.test(entry.name));
}

function resolveSha256FromRelease(release, asset, checksumText = '') {
  const directDigest = digestFromAsset(asset);
  if (directDigest) return directDigest;
  if (checksumText) {
    const checksumDigest = parseChecksumText(checksumText, asset.name);
    if (checksumDigest) return checksumDigest;
  }
  if (typeof release.body === 'string') {
    return parseChecksumText(release.body, asset.name);
  }
  return '';
}

function plannedUpdateKinds(options) {
  const kinds = [];
  if (options.updateLoader) kinds.push('loader');
  if (options.updateImage) kinds.push('image');
  if (kinds.length === 0) {
    throw new Error('Select at least the loader or the image.');
  }
  return kinds;
}

function normalizeFileKind(kind) {
  if (!VALID_FILE_KINDS.has(kind)) {
    throw new Error(`Unsupported file kind: ${kind}`);
  }
  return kind;
}

function normalizeSource(source, fieldName) {
  if (!VALID_SOURCES.has(source)) {
    throw new Error(`Unsupported ${fieldName}: ${source}`);
  }
  return source;
}

function normalizeUpdateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Invalid update options.');
  }
  for (const fieldName of ['updateLoader', 'updateImage']) {
    if (typeof options[fieldName] !== 'boolean') {
      throw new Error(`Invalid ${fieldName}: expected boolean.`);
    }
  }

  const normalized = {
    updateLoader: options.updateLoader,
    updateImage: options.updateImage,
    loaderSource: normalizeSource(options.loaderSource, 'loaderSource'),
    imageSource: normalizeSource(options.imageSource, 'imageSource'),
    loaderPath: typeof options.loaderPath === 'string' ? options.loaderPath : '',
    imagePath: typeof options.imagePath === 'string' ? options.imagePath : ''
  };
  plannedUpdateKinds(normalized);
  return normalized;
}

function describeUpdatePlan(options) {
  const normalized = normalizeUpdateOptions(options);
  const kinds = plannedUpdateKinds(normalized);
  return kinds.map((kind) => {
    const source = normalized[`${kind}Source`] === 'online' ? 'latest online file' : 'local file';
    if (kind === 'loader') {
      return `1. Update the loader from the ${source}`;
    }
    return `${kinds.indexOf(kind) + 1}. Write the image from the ${source}`;
  });
}

function simulatedDevice() {
  return {
    devNo: 1,
    vid: '2207',
    pid: '320a',
    locationId: 'SIMULATED',
    mode: 'Simulation',
    raw: 'Simulated Rockusb device'
  };
}

function isSimulatedDevice(device) {
  return device?.locationId === 'SIMULATED' || device?.mode === 'Simulation';
}

function isNoDeviceOutput(output) {
  return /not found any devices/i.test(String(output || ''));
}

async function sha256File(filePath, fsModule = fs) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fsModule.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

module.exports = {
  commandParts,
  deepMerge,
  describeUpdatePlan,
  digestFromAsset,
  executableName,
  findChecksumAsset,
  findMatchingAsset,
  findRkdeveloptool,
  githubApiFromReleasePage,
  isNoDeviceOutput,
  isSimulatedDevice,
  loadConfigFiles,
  normalizeFileKind,
  normalizeUpdateOptions,
  parseChecksumText,
  parseDevices,
  plannedUpdateKinds,
  progressFromLine,
  readJson,
  resolveSha256FromRelease,
  simulatedDevice,
  sha256File
};
