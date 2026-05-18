# RK Firmware Updater User Guide

RK Firmware Updater is a desktop application for updating Rockchip Rockusb
devices with a loader and/or a disk image. It is designed for users who do not
want to run `rkdeveloptool` commands manually.

The application is available for macOS, Linux, and Windows. A packaged build
contains the GUI, Electron runtime, configuration files, and the matching
`rkdeveloptool` binary.

## Before You Start

You need:

- a Rockchip device in Rockusb, Maskrom, or Loader mode
- the correct USB cable
- operating-system USB access configured
- enough time to let the image write complete without unplugging the device

Platform notes:

- **Windows:** the Rockusb device must use a libusb-compatible driver such as
  WinUSB. Zadig can install WinUSB for the connected Rockusb device.
- **Linux:** install a udev rule or run the application with suitable USB
  privileges.
- **macOS:** no separate driver is usually required, but the application may
  ask for permission depending on the local security settings.

## Start The Application

Launch **RK Firmware Updater**.

If no device is detected, the application offers two choices. The exact dialog
style follows your operating system, but the choices are the same:

- **Simulate** starts a safe demo mode. It does not flash real hardware.
- **Quit** closes the application so you can connect the device and try again.

![No device detected dialog](assets/screenshots/01-no-device-simulation-choice.png)

If one device is detected, the main window opens directly.

## Main Window

The top of the window shows the detected USB device. In simulation mode, the
device line clearly says `Simulation`.

![Main firmware update window](assets/screenshots/02-main-window.png)

The **Update** section contains two independent firmware parts:

- **Loader:** written first with `rkdeveloptool db <loader>`
- **Image:** written after the loader with `rkdeveloptool wl 0 <image>`

You can update only the loader, only the image, or both. When both are selected,
the application always writes the loader before the image.

## Choose Online Or Local Files

Each firmware part has two source choices:

- **Online:** download the configured file from the configured release URLs
- **Local:** select a file already present on your computer

Online files are verified with SHA256 before flashing. Local files are not
matched against the online release checksum because they may be custom builds.

The configured default URLs are visible in the window. They can be changed by
editing the GUI configuration file. See [GUI configuration](../README.md#gui-configuration).

## One-Click Online Update

Use **Latest loader + image** when you want the recommended online update in
one action.

This button is highlighted because it performs the full update sequence:

1. download the latest configured loader
2. verify the loader SHA256
3. write the loader
4. download the latest configured image
5. verify the image SHA256
6. write the image

The application asks for confirmation before it starts writing anything.

![Update confirmation dialog](assets/screenshots/03-confirm-update.png)

## During The Update

Keep the device connected and do not close the application while the update is
running. The progress bar and log show what is happening.

![Update in progress](assets/screenshots/04-update-progress.png)

The log includes:

- download status
- SHA256 verification status
- the `rkdeveloptool` command being executed
- write progress when `rkdeveloptool` reports it
- errors returned by `rkdeveloptool`

If an error occurs, the status changes to **Error** and the log keeps the
command output so it can be shared for support.

## Finish And Reboot

When the update is complete, the status changes to **Done** and the application
offers to reboot the device.

![Completed update](assets/screenshots/05-update-complete.png)

Choose reboot when you are ready to restart the target device. The application
uses `rkdeveloptool rd`.

## Safety Checklist

Before flashing real hardware:

- confirm the selected device is the expected one
- confirm whether you selected loader, image, or both
- confirm whether each selected file is online or local
- use the log to verify SHA256 status for online files
- wait for **Done** before unplugging the device

## Configuration For Administrators

The default configuration is stored in:

```text
gui/config/default.json
```

The application also reads `rkdeveloptool-gui.config.json` from the current
working directory, the Electron user data directory, or the path configured by:

```text
RKDEVELOPTOOL_GUI_CONFIG=/path/to/rkdeveloptool-gui.config.json
```

Configurable values include the GitHub release page, GitHub API URL, loader
URL, image URL, asset names, and image LBA.

## Related Documentation

- [Project README](../README.md) for download, build, and command-line notes
- [GUI developer README](../gui/README.md) for architecture, tests, and packaging
- [Contributor guide](../CONTRIBUTING.md) for quality checks and release notes
