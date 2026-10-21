# DroidBridge

A Windows x64 developer dashboard for Android devices — built with **Electron, React, TypeScript and Tailwind CSS**. DroidBridge detects devices over **USB and authorized wireless ADB**, streams **logcat**, runs **device diagnostics**, guides you through **pairing**, integrates with **Flutter** and **VS Code**, and can mirror screens with **scrcpy**.

Everything you see is real: DroidBridge shells out to the actual `adb`, `flutter`, `scrcpy` and `code` binaries. It never fabricates device data, never bypasses Android's on-device authorization prompt, and never builds shell command strings from user input.

---

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Live device list, toolchain health (adb / Flutter / scrcpy / VS Code with paths + versions), quick actions, ADB server restart |
| **Devices** | Per-device inspector: identity props, battery, display, memory, storage, IPs, plus one-click **diagnostics** with pass/warn/fail checks and hints |
| **Logcat** | Multi-buffer live streaming (`-v threadtime`, `-b main/system/crash/…`), level + search/regex filters, pause/resume, clear (`logcat -c`), export to a file you choose |
| **Pairing** | Step-by-step **USB workflow** (developer options → USB debugging → authorize) and **wireless pairing** (`adb pair ip:port code`, `adb connect`, `adb disconnect`) |
| **Flutter** | SDK detection, `flutter doctor -v`, `flutter devices`, `flutter pub get` in a folder you pick (never modifies project files) |
| **VS Code** | CLI detection, open any project folder with `code <dir>` |
| **scrcpy** | Optional mirroring with fps/bitrate/audio/on-top/fullscreen options, launch & stop managed by DroidBridge |
| **Auto-updates** | Installed builds check GitHub Releases at launch and every 4 h, download in the background, then **Restart now** (or install on quit) |

## Requirements

- Windows 10/11 x64
- [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb` on `PATH` or in `%LOCALAPPDATA%\Android\Sdk\platform-tools`, or set `ANDROID_HOME`)
- Optional: [Flutter SDK](https://docs.flutter.dev/get-started/install), [scrcpy](https://github.com/Genymobile/scrcpy) (`winget install Genymobile.scrcpy`), VS Code with the `code` CLI

DroidBridge also honours these optional overrides: `DROIDBRIDGE_ADB_PATH`, `DROIDBRIDGE_FLUTTER_PATH`, `DROIDBRIDGE_SCRCPY_PATH`, `DROIDBRIDGE_VSCODE_PATH`.

## Install (prebuilt)

Run `release\DroidBridge-Setup-1.0.0-x64.exe` — a per-user NSIS installer with Start Menu and Desktop shortcuts. No admin rights required.

Installed copies stay current: DroidBridge checks the project's [GitHub Releases](https://github.com/Abdullah-584/droidbridge/releases) for a newer version, downloads it in the background and offers **Restart now** — and installs on quit either way.

## Develop

```bash
npm install
npm run dev        # esbuild watch (main + preload) + Vite dev server + Electron
```

## Verify

```bash
npm run typecheck  # strict TypeScript across main, preload, renderer and tests
npm test           # vitest: unit + integration tests (uses the real adb on your machine)
```

## Build

```bash
npm run build      # typecheck + bundle main/preload (esbuild) + renderer (Vite)
npm run dist       # everything above + NSIS x64 installer into release/
npm run dist:dir   # unpacked app directory only (fast local smoke test)
npm start          # run the built app (dist/) with Electron
```

## Architecture in one screen

```
┌────────────────────────── renderer (sandboxed) ──────────────────────────┐
│ React views  ←  lib/api.ts (typed call/subscribe)  ←  window.droidbridge │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ contextBridge (allow-listed channels only)
┌───────────────────────────────▼──────────────────────────────────────────┐
│ preload: validates channel names, wraps ipcRenderer.invoke                │
└───────────────────────────────▲──────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────┐
│ main: ipc/registry (validate → handle → Result envelope)                 │
│   services/ (devices, pairing, tools, scrcpy, exporter)                  │
│   adb/ (locate, run: spawn without shell, parse, logcat streaming)       │
│   process/registry (tracks + kills every child process on quit)          │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ spawn(bin, argv, { shell: false })
                        adb.exe / flutter.bat / scrcpy.exe / code.cmd
```

The full contract lives in [`src/shared/types.ts`](src/shared/types.ts) (one `IpcInvokeMap` shared by both sides) — see [docs/architecture.md](docs/architecture.md).

## Security posture

- **No shell, ever.** Every external command is `spawn(bin, argv, { shell: false })`. Batch wrappers (`.bat`/`.cmd`, e.g. Flutter) go through `cmd.exe` with strict quoting and a metacharacter denylist — see [docs/security.md](docs/security.md).
- **No authorization bypass.** `unauthorized` devices get guided instructions ("accept the RSA prompt"), never key tricks.
- **Hardened renderer.** `contextIsolation`, `sandbox`, no Node integration, strict CSP, navigation and popup blocking, permission denial.
- **Validated IPC.** Every invoke is schema-validated at the boundary; errors come back as structured results.
- **No project writes.** Folders are opened, never modified; the only file DroidBridge writes is the log you explicitly export.

## Documentation

- [docs/architecture.md](docs/architecture.md) — process model, IPC contract, module map
- [docs/security.md](docs/security.md) — threat model and the guarantees above in detail
- [docs/testing.md](docs/testing.md) — test layers and how to run each
- [docs/releasing.md](docs/releasing.md) — cutting the Windows x64 installer

## License

MIT — see [LICENSE](LICENSE).
