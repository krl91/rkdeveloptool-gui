# RK Firmware Updater GUI

Electron GUI for `rkdeveloptool`.

User-facing documentation is kept in the repository-level docs:

- [Project README](../README.md)
- [User guide with screenshots](../docs/USER_GUIDE.md)
- [Contributor guide](../CONTRIBUTING.md)

## Development

```bash
npm install
npm run check
npm test
npm run coverage
npm start
```

Regenerate the screenshots used by the user guide:

```bash
npm run docs:screenshots
```

The screenshot script uses Chrome or Edge in headless mode. Set `CHROME_PATH`
if the browser is installed in a non-standard location.

## Automatic Tests

Run the automatic tests from this `gui/` directory:

```bash
npm install
npm run check
npm test
npm run coverage
```

`npm run check` validates JavaScript syntax for the GUI sources, scripts, and
tests. `npm test` runs the unit and integration tests. `npm run coverage` runs
the same tests and prints the coverage report.

The tests use Node's built-in test runner. Unit tests focus on the
deterministic business logic: configuration merging, `rkdeveloptool ld`
parsing, binary discovery, command prefixing, GitHub asset/SHA256 resolution,
local SHA256 calculation, and the mandatory loader-before-image update order.
Integration tests use `tests/fixtures/mock-rkdeveloptool.js` to validate the
GUI process runner against a controlled `rkdeveloptool` replacement without
touching real USB hardware.

## Architecture

- `src/main.js`: Electron main process, device detection, downloads, SHA256
  verification, and update orchestration.
- `src/preload.js`: narrow IPC bridge exposed to the renderer.
- `src/renderer.js`: DOM event handling and UI state updates.
- `src/lib.js`: deterministic helper functions covered by unit tests.
- `src/toolRunner.js`: real `rkdeveloptool` process runner.
- `src/simulationRunner.js`: no-hardware simulation runner.
- `src/windowFactory.js`: BrowserWindow construction and security options.
- `tests/`: unit and integration tests.

The renderer is intentionally unprivileged: Node.js integration is disabled,
context isolation is enabled, sandboxing is enabled, and the HTML document
declares a restrictive Content Security Policy. IPC input is validated in the
main process before it can start a flash operation.

The app looks for `rkdeveloptool` in this order:

1. packaged resources: `resources/bin/rkdeveloptool(.exe)`
2. development bundle: `gui/bin/rkdeveloptool(.exe)`
3. repository root: `../rkdeveloptool`
4. `PATH`

## Configuration

Defaults are in `config/default.json`. Override them with a
`rkdeveloptool-gui.config.json` file in the current working directory, in the
Electron user data directory, or by setting `RKDEVELOPTOOL_GUI_CONFIG`.

The GitHub release page and API URLs are configurable. For online updates, the
app reads the release metadata, finds the requested asset, and verifies the
download with the SHA256 digest published by GitHub. If the digest is not
available, it searches a checksum asset or the release body.

The online guide opened from the GUI is configurable through
`documentationUrl`. Network timeouts are configurable through
`network.metadataTimeoutMs` and `network.downloadTimeoutMs`. Defaults are
deliberately large: 300000 ms for metadata and 7200000 ms for firmware
downloads.

When a custom configuration file is loaded, the renderer shows a persistent
warning banner. The confirmation dialog also lists the release, loader, and
image source hosts before the update starts.

## Packaging

Build `rkdeveloptool` first on the same OS and architecture, preferably with
`--enable-standalone`, then run:

```bash
npm run dist
```

The repository root can also build the command-line tool and package the GUI
from one `make` command:

```bash
autoreconf -i
./configure --enable-standalone --enable-gui
make -j$(nproc)
```

On macOS, use `make -j$(sysctl -n hw.ncpu)` if `nproc` is not available.
Without `--enable-gui`, the normal `make` only builds `rkdeveloptool`; use
`make gui` from the repository root to package the GUI manually.

The packaging script copies `../rkdeveloptool` or `../rkdeveloptool.exe` into
`gui/bin/` automatically. `electron-builder` then embeds it in the application
resources, so the final app contains:

- the Electron runtime
- all GUI JavaScript/CSS/config files
- production Node dependencies
- the matching `rkdeveloptool` binary

This means the user does not need Node.js, npm, Electron, or a separately
installed `rkdeveloptool`.

Build packages on the target OS:

- macOS: produces a DMG
- Linux: produces an AppImage
- Windows: produces an NSIS installer

For macOS distribution outside a development machine, use the repository
workflow `.github/workflows/macos-release.yml`. It produces an ad hoc signed DMG
when Apple secrets are absent, or a signed and notarized DMG when they are
configured.

For Windows release builds, use `.github/workflows/windows-release.yml`. It
builds `rkdeveloptool.exe` with MSYS2 UCRT64, then produces the NSIS installer.

For Linux release builds, use `.github/workflows/linux-release.yml`. It builds
`rkdeveloptool` on Ubuntu/Debian, then produces the AppImage.

For a quick unpacked build:

```bash
npm run dist:dir
```

## Complete Build Commands

Run these commands from a fresh checkout to produce the final standalone GUI
application for the current OS.

### macOS

Install Homebrew first if the `brew` command is not available:

https://brew.sh/

```bash
brew install automake autoconf libusb pkg-config git wget node

git clone https://github.com/krl91/rkdeveloptool-gui.git
cd rkdeveloptool-gui

autoreconf -i
./configure --enable-standalone
make -j$(sysctl -n hw.ncpu)

cd gui
npm install
npm run dist
```

The output is written to `gui/dist/`.

### Linux Debian/Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y libudev-dev libusb-1.0-0-dev dh-autoreconf \
  pkg-config libusb-1.0 build-essential git wget nodejs npm

git clone https://github.com/krl91/rkdeveloptool-gui.git
cd rkdeveloptool-gui

autoreconf -i
./configure --enable-standalone
make -j$(nproc)

cd gui
npm install
npm run dist
```

The output is written to `gui/dist/`.

### Windows

Use the **MSYS2 UCRT64** shell. Do not use the CLANG64, MINGW64, or MSYS shell
with the commands below.

```bash
pacman -Syu
# If MSYS2 asks you to close the terminal after pacman -Syu, close it,
# reopen "MSYS2 UCRT64", then continue below.
pacman -S --needed git wget autoconf automake make pkgconf \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-pkgconf \
  mingw-w64-ucrt-x86_64-libusb \
  mingw-w64-ucrt-x86_64-nodejs

echo $MSYSTEM
gcc --version
node --version
npm --version
git clone https://github.com/krl91/rkdeveloptool-gui.git
cd rkdeveloptool-gui

autoreconf -i
./configure --enable-standalone
make -j$(nproc)

cd gui
npm install
npm run dist
```

The output is written to `gui/dist/`.

Use `npm run dist:dir` instead of `npm run dist` for a faster unpacked test
build.

If `./configure` reports `no acceptable C compiler found in $PATH`, you are
usually in the wrong MSYS2 shell. The UCRT64 package names only work from the
UCRT64 shell. Run `echo $MSYSTEM`; it must print `UCRT64`. If it prints
`CLANG64`, close the terminal and open **MSYS2 UCRT64**.

If `npm` is not found when building the GUI, install Node.js in the same UCRT64
shell. The MSYS2 Node.js package also provides npm:

```bash
pacman -S --needed mingw-w64-ucrt-x86_64-nodejs
hash -r
node --version
npm --version
```

The firmware assets are not embedded. The app downloads them on demand from the
configured release URLs and verifies SHA256 before flashing.

USB permissions and drivers are still OS-specific. Linux users should install
udev rules or run with suitable privileges. On Windows, try the updater first;
if it does not detect the ground station in Maskrom/Loader mode, use Zadig
from https://zadig.akeo.ie/ to select the Rockusb/Maskrom/Loader USB entry and
assign the WinUSB driver.
