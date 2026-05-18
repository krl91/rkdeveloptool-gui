# Contributing

Thank you for improving `rkdeveloptool`.

## Development Setup

Build the command-line tool first:

```bash
autoreconf -i
./configure --enable-standalone
make -j$(nproc)
```

On macOS, use:

```bash
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
make gui-test
```

For GUI-only changes, this is equivalent:

```bash
cd gui
npm run check
npm test
npm run coverage
```

The GUI integration tests use `gui/tests/fixtures/mock-rkdeveloptool.js`; they
do not require a Rockusb device and do not flash real hardware.

Pull requests run the same GUI checks through GitHub Actions:

```bash
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
- Linux: AppImage
- Windows: NSIS installer

## macOS Signing And Notarization

The macOS release workflow is `.github/workflows/macos-release.yml`. It runs on
tag pushes matching `v*` and can also be started manually from GitHub Actions.

Configure these repository secrets before using it:

- `MACOS_CSC_LINK`: Developer ID Application certificate as a base64 encoded
  `.p12`, or another `electron-builder` supported certificate reference.
- `MACOS_CSC_KEY_PASSWORD`: password for the `.p12` certificate.
- `APPLE_API_KEY_BASE64`: base64 encoded App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

The workflow writes the `.p8` key to the runner, builds `rkdeveloptool`, runs
`npm run dist:mac`, uploads the signed/notarized DMG as a workflow artifact,
and attaches the DMG to the matching GitHub release. For manual runs, set the
`tag_name` input to the release tag to update, for example `v0.1.0`.

The Electron macOS build uses hardened runtime and the entitlements in
`gui/build/entitlements.mac.plist` and
`gui/build/entitlements.mac.inherit.plist`. A project-specific icon is still
recommended before publishing public release builds.
