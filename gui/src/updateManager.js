const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function timeoutSignal(timeoutMs) {
  if (!timeoutMs) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeout = timeoutSignal(options.timeoutMs);
  try {
    return await options.fetchImpl(url, {
      headers: { 'User-Agent': 'rkdeveloptool-gui' },
      signal: timeout?.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Network request timed out after ${options.timeoutMs} ms: ${url}`);
    }
    throw error;
  } finally {
    timeout?.clear();
  }
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split(/[+-]/)[0];
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number(part) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function releaseVersion(release) {
  return normalizeVersion(release?.tag_name || release?.name || '');
}

function updateAssetCandidates(platform, arch, options = {}) {
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? [/arm64\.dmg$/i, /universal\.dmg$/i]
      : [/(x64|x86_64|amd64)\.dmg$/i, /universal\.dmg$/i];
  }
  if (platform === 'win32') {
    return [/setup.*\.exe$/i, /\.exe$/i];
  }
  if (platform === 'linux') {
    const packageType = options.linuxPackage || 'deb';
    if (packageType === 'rpm') {
      return arch === 'arm64'
        ? [/aarch64\.rpm$/i, /arm64\.rpm$/i]
        : [/x86_64\.rpm$/i, /amd64\.rpm$/i, /\.rpm$/i];
    }
    if (packageType === 'appimage') {
      return arch === 'arm64'
        ? [/arm64\.AppImage$/i, /aarch64\.AppImage$/i]
        : [/x86_64\.AppImage$/i, /amd64\.AppImage$/i, /\.AppImage$/i];
    }
    return arch === 'arm64'
      ? [/arm64\.deb$/i]
      : [/amd64\.deb$/i, /x86_64\.deb$/i];
  }
  return [];
}

function selectUpdateAsset(release, options = {}) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const patterns = updateAssetCandidates(options.platform, options.arch, options);
  for (const pattern of patterns) {
    const asset = assets.find((entry) => pattern.test(entry.name || ''));
    if (asset) return asset;
  }
  return null;
}

async function checkForAppUpdate(options = {}) {
  if (!options.enabled) return { checked: false, available: false, reason: 'disabled' };
  if (options.isOnline === false) return { checked: false, available: false, reason: 'offline' };
  if (!options.releaseApiUrl) return { checked: false, available: false, reason: 'missing-release-url' };

  const response = await fetchWithTimeout(options.releaseApiUrl, options);
  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`);
  }
  const release = await response.json();
  const latestVersion = releaseVersion(release);
  if (!latestVersion || compareVersions(latestVersion, options.currentVersion) <= 0) {
    return { checked: true, available: false, latestVersion, release };
  }

  const asset = selectUpdateAsset(release, options);
  if (!asset) {
    throw new Error(`No update asset found for ${options.platform}/${options.arch}.`);
  }
  return {
    checked: true,
    available: true,
    currentVersion: normalizeVersion(options.currentVersion),
    latestVersion,
    release,
    asset
  };
}

function sha256FromAsset(asset) {
  if (typeof asset?.digest === 'string' && asset.digest.startsWith('sha256:')) {
    return asset.digest.slice('sha256:'.length).toLowerCase();
  }
  return '';
}

async function cleanupTempFile(writer, tempDestination, fsModule) {
  if (writer && !writer.destroyed && !writer.closed) {
    await new Promise((resolve) => {
      writer.once('close', resolve);
      writer.destroy();
    });
  }
  try {
    fsModule.rmSync(tempDestination, { force: true });
  } catch {
    // Best-effort rollback cleanup.
  }
}

async function downloadUpdateAsset(asset, options = {}) {
  const fsModule = options.fsModule || fs;
  const cryptoModule = options.cryptoModule || crypto;
  const downloadDir = options.downloadDir;
  const url = asset.browser_download_url || asset.url;
  const assetName = path.basename(asset.name || '');
  if (!downloadDir) throw new Error('No update download directory configured.');
  if (!assetName || assetName !== asset.name) throw new Error(`Unsafe update asset name: ${asset.name}`);
  if (!url) throw new Error(`No download URL for update asset: ${asset.name}`);

  fsModule.mkdirSync(downloadDir, { recursive: true });
  const destination = path.join(downloadDir, assetName);
  const tempDestination = `${destination}.download`;
  const expectedSha256 = sha256FromAsset(asset);
  const hash = cryptoModule.createHash('sha256');

  const response = await fetchWithTimeout(url, options);
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed (${response.status})`);
  }

  const total = Number(response.headers?.get?.('content-length') || 0);
  let received = 0;
  const writer = fsModule.createWriteStream(tempDestination);
  const reader = response.body.getReader();

  try {
    await new Promise((resolve, reject) => {
      writer.once('error', reject);
      writer.once('open', resolve);
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.byteLength;
      hash.update(chunk);
      if (typeof options.onProgress === 'function' && total > 0) {
        options.onProgress(Math.floor((received / total) * 100));
      }
      if (!writer.write(chunk)) {
        await new Promise((resolve, reject) => {
          writer.once('drain', resolve);
          writer.once('error', reject);
        });
      }
    }

    await new Promise((resolve, reject) => writer.end((error) => error ? reject(error) : resolve()));

    if (total > 0 && received !== total) {
      fsModule.rmSync(tempDestination, { force: true });
      throw new Error(`Incomplete update download: received ${received} of ${total} bytes.`);
    }

    const actualSha256 = hash.digest('hex');
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      fsModule.rmSync(tempDestination, { force: true });
      throw new Error(`Invalid update SHA256 for ${asset.name}: ${actualSha256}`);
    }

    fsModule.renameSync(tempDestination, destination);
    return { filePath: destination, sha256: actualSha256 };
  } catch (error) {
    await cleanupTempFile(writer, tempDestination, fsModule);
    throw error;
  }
}

function installCommand(filePath, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return { command: 'open', args: [filePath] };
  if (platform === 'win32') return { command: filePath, args: [] };
  if (/\.deb$/i.test(filePath)) return { command: 'pkexec', args: ['apt', 'install', '-y', filePath] };
  if (/\.rpm$/i.test(filePath)) return { command: 'pkexec', args: ['dnf', 'install', '-y', filePath] };
  if (/\.AppImage$/i.test(filePath)) return { command: filePath, args: [] };
  throw new Error(`Unsupported update installer: ${filePath}`);
}

async function installUpdate(filePath, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const { command, args } = installCommand(filePath, options);
  const timeoutMs = options.timeoutMs;

  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    });
    let finished = false;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill?.();
        reject(new Error(`Update installer timed out after ${timeoutMs} ms.`));
      }, timeoutMs)
      : null;

    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Update installer failed with code ${code}.`));
    });
  });

  return { ok: true, command, args };
}

module.exports = {
  checkForAppUpdate,
  compareVersions,
  downloadUpdateAsset,
  installCommand,
  installUpdate,
  normalizeVersion,
  selectUpdateAsset,
  updateAssetCandidates
};
