# Implementation Plan: DroidBridge

## Overview

DroidBridge is a Windows x64 desktop application (Electron + React + TypeScript + Tailwind CSS) that detects Android devices over USB and authorized wireless ADB, and gives developers a polished dashboard: device diagnostics, logcat streaming, USB/wireless pairing workflows, Flutter and VS Code integration, and optional scrcpy screen mirroring. All device interaction uses the real `adb`/`flutter`/`scrcpy`/`code` binaries via argument-array `spawn` (never shell strings), and authorization is never bypassed.

## Architecture Decisions

- **Contract-first IPC.** `src/shared/` defines types, channel names, and validators shared by main and renderer. The preload exposes a typed, allow-listed API; `ipcMain.handle` registration goes through a validating registry so no channel can be invoked with unvalidated input.
- **Safe process execution.** Every external command goes through one runner (`src/main/adb/run.ts`) using `spawn(bin, argv, { shell: false })` with timeouts, output caps, and registry bookkeeping. No command string is ever assembled from user input.
- **Real data only.** Devices, diagnostics, logcat, Flutter/VS Code/scrcpy status all come from real binaries. Missing tools are reported honestly (with install hints) — never faked.
- **No authorization bypass.** The app only reads device state; `unauthorized`/`offline` states are surfaced with guided steps (accept the RSA prompt on-device). No key wiping, no `adb usb` force-recovery without an authorized device, no adbd tampering.
- **Renderer sandbox.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation/window-open blocked, permission requests denied.
- **Build split.** esbuild bundles main + preload (CJS); Vite builds the renderer; electron-builder produces the NSIS x64 installer.

## Task List

### Phase 1: Foundation
- [x] Task 1: Plan + task list
- [x] Task 2: Project scaffold, configs, dependency install
- [x] Task 3: Shared contract (types, channels, validation) + unit tests
- [x] Checkpoint: `npm run typecheck` + `npm test` pass

### Phase 2: Main-process core
- [x] Task 4: ADB locator, safe runner, parsers, process registry + tests
- [x] Task 5: Typed IPC registry + preload bridge + tests
- [x] Checkpoint: core tests green

### Phase 3: Features (vertical slices)
- [x] Task 6: Device listing + device details + diagnostics handler
- [x] Task 7: Logcat streaming sessions (start/stop/clear/export)
- [x] Task 8: USB + wireless pairing workflows
- [x] Task 9: Flutter integration (detect, doctor, devices, pub get)
- [x] Task 10: VS Code integration (detect, open folder/file)
- [x] Task 11: scrcpy mirroring (detect, launch, stop)
- [x] Checkpoint: handler tests + typecheck green

### Phase 4: UI
- [x] Task 12: App shell, navigation, design system, dashboard
- [x] Task 13: Devices + diagnostics views
- [x] Task 14: Logcat view (filters, pause, export)
- [x] Task 15: Pairing view (USB + wireless wizards)
- [x] Task 16: Tools view (Flutter, VS Code, scrcpy) + renderer component tests
- [x] Checkpoint: build + tests green

### Phase 5: Ship
- [x] Task 17: Documentation (README, architecture, security, testing, releasing)
- [x] Task 18: electron-builder NSIS x64 installer + full verification
  - `release/DroidBridge-Setup-1.0.0-x64.exe` (106.6 MiB, valid NSIS PE)
  - packaged app launched: main + renderer processes alive, then cleanly stopped
  - final gate: typecheck exit 0, 89/89 tests, renderer+main bundles in app.asar

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Electron/electron-builder downloads blocked | High | Pin versions, fall back to reporting the config + verified local build |
| No physical device attached during tests | Med | Integration tests use real `adb version`/`adb devices -l` (no device needed); parsers covered with fixture output |
| Long-running streams (logcat/doctor) flood IPC | Med | Batched line delivery, output caps, registry kill on quit |

## Open Questions
- None blocking; scrcpy/Flutter absence is handled as an honest "not installed" state with install guidance.
