const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALID_FILE_KINDS = new Set(['loader', 'image']);
const VALID_SOURCES = new Set(['online', 'local']);
const CURRENT_CONFIG_RELEASE_VERSION = '0.1.9';
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

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function releaseVersion(config) {
  return typeof config?.releaseVersion === 'string' && config.releaseVersion.trim()
    ? config.releaseVersion.trim()
    : '';
}

function validateFirmwareEndpointConfig(config, fieldName) {
  const section = config?.[fieldName];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`Invalid ${fieldName} configuration: expected object.`);
  }
  if (typeof section.assetName !== 'string' || section.assetName.trim() === '') {
    throw new Error(`Invalid ${fieldName}.assetName: expected non-empty string.`);
  }
  if (typeof section.url !== 'string' || section.url.trim() === '') {
    throw new Error(`Invalid ${fieldName}.url: expected non-empty string.`);
  }
  if (section.choices !== undefined) {
    if (!Array.isArray(section.choices)) {
      throw new Error(`Invalid ${fieldName}.choices: expected array.`);
    }
    for (const [index, choice] of section.choices.entries()) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
        throw new Error(`Invalid ${fieldName}.choices[${index}]: expected object.`);
      }
      for (const choiceField of ['id', 'label', 'assetName', 'url']) {
        if (typeof choice[choiceField] !== 'string' || choice[choiceField].trim() === '') {
          throw new Error(`Invalid ${fieldName}.choices[${index}].${choiceField}: expected non-empty string.`);
        }
      }
    }
  }
}

function validateConfigShape(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid configuration: expected object.');
  }
  if (config.releaseVersion !== undefined && typeof config.releaseVersion !== 'string') {
    throw new Error('Invalid releaseVersion: expected string.');
  }
  validateFirmwareEndpointConfig(config, 'loader');
  validateFirmwareEndpointConfig(config, 'image');
  if (config.image.lba !== undefined && (!Number.isInteger(config.image.lba) || config.image.lba < 0)) {
    throw new Error('Invalid image.lba: expected non-negative integer.');
  }
}

function migrateConfig(config, defaultConfig = {}, currentVersion = CURRENT_CONFIG_RELEASE_VERSION) {
  const migrated = cloneConfig(config);
  const sourceVersion = releaseVersion(migrated) || 'legacy';
  const changes = [];

  if (releaseVersion(migrated) !== currentVersion) {
    migrated.releaseVersion = currentVersion;
    changes.push('releaseVersion');
  }

  if (!migrated.image || typeof migrated.image !== 'object' || Array.isArray(migrated.image)) {
    migrated.image = {};
    changes.push('image');
  }

  const defaultImage = defaultConfig?.image && typeof defaultConfig.image === 'object' && !Array.isArray(defaultConfig.image)
    ? defaultConfig.image
    : {};

  for (const fieldName of ['assetName', 'url', 'lba']) {
    if (migrated.image[fieldName] === undefined && defaultImage[fieldName] !== undefined) {
      migrated.image[fieldName] = cloneConfig(defaultImage[fieldName]);
      changes.push(`image.${fieldName}`);
    }
  }

  if (!Array.isArray(migrated.image.choices) && Array.isArray(defaultImage.choices)) {
    migrated.image.choices = cloneConfig(defaultImage.choices);
    changes.push('image.choices');
  }

  validateConfigShape(migrated);

  return {
    config: migrated,
    migration: changes.length > 0
      ? {
        fromReleaseVersion: sourceVersion,
        toReleaseVersion: currentVersion,
        changes
      }
      : null
  };
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

function phaseProgressRange(index, total, label = '') {
  return {
    progressLabel: label,
    progressOffset: (index / total) * 100,
    progressScale: 1 / total
  };
}

function progressSubrange(progressOptions, startPercent, endPercent, label = progressOptions.progressLabel) {
  return {
    progressLabel: label,
    progressOffset: progressOptions.progressOffset + (startPercent * progressOptions.progressScale),
    progressScale: ((endPercent - startPercent) / 100) * progressOptions.progressScale
  };
}

function splitProgressForSource(progressOptions, source) {
  if (source === 'online') {
    return {
      download: progressSubrange(progressOptions, 0, 50),
      flash: progressSubrange(progressOptions, 50, 100)
    };
  }
  return {
    download: null,
    flash: progressOptions
  };
}

function mappedPhaseProgress(progressOptions, percent) {
  return Math.max(0, Math.min(100, Math.round(
    progressOptions.progressOffset + (percent * progressOptions.progressScale)
  )));
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
    loaderChoiceLabel: typeof options.loaderChoiceLabel === 'string' ? options.loaderChoiceLabel : '',
    imageChoiceId: typeof options.imageChoiceId === 'string' ? options.imageChoiceId : '',
    imageChoiceLabel: typeof options.imageChoiceLabel === 'string' ? options.imageChoiceLabel : '',
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
      const detail = normalized.loaderSource === 'online' && normalized.loaderChoiceLabel
        ? ` (${normalized.loaderChoiceLabel})`
        : '';
      return `1. Load the Maskrom loader from the ${source}${detail}`;
    }
    const detail = normalized.imageSource === 'online' && normalized.imageChoiceLabel
      ? ` (${normalized.imageChoiceLabel})`
      : '';
    return `${kinds.indexOf(kind) + 1}. Write the image from the ${source}${detail}`;
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
  const imageChoices = Array.isArray(config?.image?.choices) ? config.image.choices : [];
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
      choices: imageChoices.map((choice) => ({
        id: choice.id || '',
        label: choice.label || choice.assetName || choice.url || '',
        assetName: choice.assetName || '',
        url: choice.url || ''
      })),
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
  CURRENT_CONFIG_RELEASE_VERSION,
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
  phaseProgressRange,
  plannedUpdateKinds,
  progressFromLine,
  progressSubrange,
  publicConfig,
  readJson,
  resolveSha256FromRelease,
  mappedPhaseProgress,
  migrateConfig,
  shouldHashLocalFile,
  simulatedDevice,
  splitProgressForSource,
  sourceSummary,
  urlHost,
  isSafeExternalUrl,
  validateCommandPrefix,
  validateConfigShape,
  validateLocalPathSelection,
  sha256File
};
