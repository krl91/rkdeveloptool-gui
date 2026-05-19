const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALID_FILE_KINDS = new Set(['loader', 'image']);
const VALID_SOURCES = new Set(['online', 'local']);
const ALLOWED_COMMAND_PREFIXES = {
  sudo: new Set(['-n']),
  pkexec: new Set(),
  doas: new Set(['-n'])
};
const noDeviceHelpDetail = [
  'RunCam WiFiLink RX / OpenIPC ground stations: before starting the application, connect the USB-C data cable while holding the reset/flash button with a paper clip for about 2 seconds, then release it.',
  'If the receiver needs separate DC power, apply power while holding the button, wait 2 seconds, then release it.',
  'You can simulate a device to open the interface without flashing real hardware, or close the application.'
].join('\n\n');

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
  return loadConfigFilesWithSources(defaultConfigPath, candidates, fsModule).config;
}

function loadConfigFilesWithSources(defaultConfigPath, candidates, fsModule = fs) {
  let config = readJson(defaultConfigPath, fsModule);
  const overrides = [];
  for (const candidate of candidates.filter(Boolean)) {
    if (fsModule.existsSync(candidate)) {
      config = deepMerge(config, readJson(candidate, fsModule));
      overrides.push(candidate);
    }
  }
  return {
    config,
    defaultConfigPath,
    overrides
  };
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'rkdeveloptool.exe' : 'rkdeveloptool';
}

function findRkdeveloptool(config, options = {}) {
  return findRkdeveloptoolWithDiagnostics(config, options).path;
}

function rkdeveloptoolSearchPaths(options = {}) {
  const name = executableName(options.platform);
  return Array.from(new Set([
    path.join(options.resourcesPath || '', 'bin', name),
    path.join(options.guiRoot || '', 'bin', name),
    path.join(options.repoRoot || '', name),
    path.join(options.cwd || process.cwd(), name)
  ].filter((candidate) => candidate !== path.join('bin', name))));
}

function findRkdeveloptoolWithDiagnostics(config, options = {}) {
  if (config.rkdeveloptoolPath) {
    return {
      path: config.rkdeveloptoolPath,
      searchPaths: [config.rkdeveloptoolPath],
      usesPathFallback: false
    };
  }

  const fsModule = options.fsModule || fs;
  const name = executableName(options.platform);
  const candidates = rkdeveloptoolSearchPaths(options);

  for (const candidate of candidates) {
    if (fsModule.existsSync(candidate)) {
      return {
        path: candidate,
        searchPaths: candidates,
        usesPathFallback: false
      };
    }
  }
  return {
    path: name,
    searchPaths: candidates,
    usesPathFallback: true
  };
}

function validateCommandPrefix(prefix, options = {}) {
  if (!Array.isArray(prefix) || prefix.length === 0) return [];
  if (options.allowUnsafeCommandPrefix) return prefix;

  const command = path.basename(prefix[0]);
  const allowedArgs = ALLOWED_COMMAND_PREFIXES[command];
  if (!allowedArgs) {
    throw new Error(`Unsupported commandPrefix executable: ${prefix[0]}`);
  }
  for (const arg of prefix.slice(1)) {
    if (!allowedArgs.has(arg)) {
      throw new Error(`Unsupported commandPrefix argument for ${command}: ${arg}`);
    }
  }
  return prefix;
}

function commandParts(toolPath, args, config = {}, options = {}) {
  const prefix = validateCommandPrefix(config.commandPrefix, options);
  if (prefix.length > 0) {
    return { command: prefix[0], args: [...prefix.slice(1), toolPath, ...args] };
  }
  return { command: toolPath, args };
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/DevNo=(\d+)\s+Vid=0x([0-9a-fA-F]+),Pid=0x([0-9a-fA-F]+),LocationID=([^\s]+)\s+(.+)/);
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
    loaderChoiceId: typeof options.loaderChoiceId === 'string' ? options.loaderChoiceId : '',
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
      return `1. Load the Maskrom loader from the ${source}`;
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
  const text = String(output || '');
  return /not found any devices/i.test(text) ||
    /no devices? found/i.test(text) ||
    /no rockusb devices? found/i.test(text) ||
    /did not find any rockusb device/i.test(text);
}

function normalizeTimeoutMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function normalizeLocalPath(filePath) {
  return path.resolve(String(filePath || ''));
}

function validateLocalPathSelection(kind, localPath, allowedLocalPaths) {
  if (!localPath) {
    throw new Error(`No local file selected for ${kind}.`);
  }
  if (!allowedLocalPaths || !allowedLocalPaths.has(normalizeLocalPath(localPath))) {
    throw new Error(`Local ${kind} file must be selected with the file picker.`);
  }
  return localPath;
}

function shouldHashLocalFile(options = {}) {
  return !options.simulation;
}

function urlHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function publicConfig(config) {
  const loaderChoices = Array.isArray(config?.loader?.choices) ? config.loader.choices : [];
  return {
    documentationUrl: config?.documentationUrl || '',
    loader: {
      url: config?.loader?.url || '',
      choices: loaderChoices.map((choice) => ({
        id: choice.id || '',
        label: choice.label || choice.assetName || choice.url || '',
        assetName: choice.assetName || '',
        url: choice.url || ''
      }))
    },
    image: {
      url: config?.image?.url || '',
      lba: config?.image?.lba ?? 0
    }
  };
}

function sourceSummary(config) {
  const releaseApiUrl = config?.releaseApiUrl || githubApiFromReleasePage(config?.releasePageUrl);
  return {
    releaseApiHost: urlHost(releaseApiUrl),
    loaderHost: urlHost(config?.loader?.url),
    imageHost: urlHost(config?.image?.url)
  };
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
  findRkdeveloptoolWithDiagnostics,
  githubApiFromReleasePage,
  isNoDeviceOutput,
  isSimulatedDevice,
  noDeviceHelpDetail,
  loadConfigFiles,
  loadConfigFilesWithSources,
  normalizeLocalPath,
  normalizeFileKind,
  normalizeTimeoutMs,
  normalizeUpdateOptions,
  parseChecksumText,
  parseDevices,
  plannedUpdateKinds,
  progressFromLine,
  publicConfig,
  readJson,
  resolveSha256FromRelease,
  shouldHashLocalFile,
  simulatedDevice,
  sourceSummary,
  urlHost,
  isSafeExternalUrl,
  validateCommandPrefix,
  validateLocalPathSelection,
  sha256File
};
