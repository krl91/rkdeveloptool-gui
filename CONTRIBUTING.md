# Contributing

Thank you for improving `rkdeveloptool`.

## Development Setup

Build the command-line tool first:

```bash
autoreconf -i
./configure --enable-standalone
make -j$(nproc)
```

On macOS, install Homebrew GCC and configure with GNU `g++`. Apple Clang is not
the supported compiler for the upstream C++ sources:

```bash
brew install automake autoconf libusb pkg-config gcc node
autoreconf -i
CXX="$(brew --prefix)/bin/g++-15" ./configure --enable-standalone
make -j$(sysctl -n hw.ncpu)
```

For GUI development:

```bash
cd gui
npm install
npm start
```

## Quality Checks

Run these checks before submitting changes:

```bash
make
make check
make gui-test
```

`make check` runs the C++ unit tests in `tests/cpp/`. They cover deterministic
parser/helper logic and do not require a Rockusb device.

For GUI-only changes, also run:

```bash
cd gui
npm run check
npm test
npm run coverage
```

The GUI integration tests use `gui/tests/fixtures/mock-rkdeveloptool.js`; they
do not require a Rockusb device and do not flash real hardware.

Pull requests run the same C++ and GUI checks through GitHub Actions:

```bash
make check
make gui-test
```

To remove build outputs without deleting installed npm dependencies:

```bash
make clean
```

This cleans the command-line objects/binary, root logs, GUI package outputs,
GUI logs, and the copied `gui/bin/rkdeveloptool` binary. It intentionally keeps
`gui/node_modules/` so repeated development builds stay fast.

## Project Layout

- `main.cpp` and `RK*.cpp`: command-line tool and Rockusb logic.
- `configure.ac` and `Makefile.am`: Autotools build configuration.
- `tests/cpp/`: C++ unit tests for deterministic rkdeveloptool helpers.
- `gui/src/main.js`: Electron main process, device detection, downloads, and flashing workflow.
- `gui/src/renderer.js`: browser-side UI behavior.
- `gui/src/lib.js`: deterministic helpers covered by unit tests.
- `gui/src/toolRunner.js`: real `rkdeveloptool` process runner.
- `gui/src/simulationRunner.js`: no-hardware simulation runner.
- `gui/tests/`: unit and integration tests.

## Coding Guidelines

- Keep CLI changes separate from GUI changes when possible.
- Keep Electron renderer code unprivileged: no Node.js integration in the renderer.
- Validate all IPC input in the main process before using it.
- Keep network downloads in the main process and verify online firmware with SHA256 before flashing.
- Add tests for bug fixes and user-visible workflow changes.
- Avoid committing generated artifacts such as `gui/dist/`, `gui/node_modules/`, object files, and local workspace files.

## Packaging Notes

The GUI package embeds the matching `rkdeveloptool` binary from the repository
root. Build release packages on the target operating system:

- macOS: DMG
- Linux: AppImage, Debian package, and RPM where supported
- Windows: NSIS installer

## macOS Signing And Notarization

The macOS release workflow is `.github/workflows/macos-release.yml`. It runs on
tag pushes matching `v*` and can also be started manually from GitHub Actions.
It always builds a DMG. If Apple signing/notarization secrets are not
configured, the workflow falls back to an ad hoc signed DMG. That build is
usable, but macOS may show a security warning on first launch.

Configure these repository secrets to produce a Developer ID signed and
notarized DMG:

- `MACOS_CSC_LINK`: Developer ID Application certificate as a base64 encoded
  `.p12`, or another `electron-builder` supported certificate reference.
- `MACOS_CSC_KEY_PASSWORD`: password for the `.p12` certificate.
- `APPLE_API_KEY_BASE64`: base64 encoded App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

When the secrets are present, the workflow writes the `.p8` key to the runner,
builds `rkdeveloptool` with Homebrew GCC, runs `npm run dist:mac`, uploads the
signed/notarized DMG as a workflow artifact, and attaches the DMG to the
matching GitHub release. When the secrets are absent, the same command produces
an ad hoc signed DMG and still uploads it. For manual runs, set the `tag_name`
input to the release tag to update, for example `v0.1.3`.

The Electron macOS build uses hardened runtime and the entitlements in
`gui/build/entitlements.mac.plist` and
`gui/build/entitlements.mac.inherit.plist`. A project-specific icon is still
recommended before publishing public release builds.

## Windows Release Workflow

The Windows release workflow is `.github/workflows/windows-release.yml`. It runs
on tag pushes matching `v*` and can also be started manually from GitHub
Actions.

The workflow uses MSYS2 UCRT64 to install the MinGW toolchain and libusb, builds
`rkdeveloptool.exe` with `./configure --enable-standalone`, runs the GUI checks,
then runs:

```bash
npm run dist:win
```

The resulting NSIS installer and blockmap are uploaded as workflow artifacts and
attached to the matching GitHub release. For manual runs, set the `tag_name`
input to the release tag to update, for example `v0.1.3`.

## Linux Release Workflow

The Linux release workflow is `.github/workflows/linux-release.yml`. It runs on
tag pushes matching `v*` and can also be started manually from GitHub Actions.

The workflow uses Ubuntu/Debian packages to install Autotools, libusb, libudev,
and AppImage runtime support. It builds `rkdeveloptool` natively on x64 and
arm64 runners with:

```bash
./configure --enable-standalone
make -j"$(nproc)"
```

It then runs the GUI checks and builds Linux packages with:

```bash
npm run dist:linux:x64    # AppImage, deb, rpm
npm run dist:linux:arm64  # AppImage, deb
```

The resulting AppImage, Debian, RPM, and optional blockmap files are uploaded as
workflow artifacts and attached to the matching GitHub release. For manual runs,
set the `tag_name` input to the release tag to update, for example `v0.1.3`.
