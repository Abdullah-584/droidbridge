# DroidBridge Architecture

## Process model

DroidBridge is a three-part Electron app:

| Part | Bundled from | Runs in | Responsibility |
| --- | --- | --- | --- |
| **Main** | `src/main` → `dist/main/main.js` (esbuild, CJS) | Node (Electron main) | All external I/O: adb/flutter/scrcpy/code, dialogs, process lifecycle |
| **Preload** | `src/preload` → `dist/preload/preload.cjs` (esbuild, CJS) | Sandboxed renderer | Exposes the minimal typed bridge `window.droidbridge` via `contextBridge` |
| **Renderer** | `src/renderer` → `dist/renderer` (Vite) | Chromium | React UI only — no Node, no direct `ipcRenderer` |

`src/shared/` is imported by all three: types, IPC channel names and input validators. It is deliberately free of Node built-ins so it can be bundled into the sandboxed preload.

## The IPC contract

The single source of truth is `IpcInvokeMap` in `src/shared/types.ts`:

```ts
export interface IpcInvokeMap {
  'devices:list':      { args: null;                  result: DeviceListResult };
  'devices:details':   { args: { serial: string };    result: DeviceDetails };
  'logcat:start':      { args: LogcatOptions;         result: LogcatStartResult };
  // … one entry per channel
}
```

- **Main** registers exactly this set through `registerInvokeHandlers(ipcMain, specs)`. `createHandlerSpecs()` pairs a `validate(raw)` (from `src/shared/validation.ts`) with a typed `handle(args)`.
- **Every invoke resolves to `Result<T>`** — `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. One error strategy, no Electron error-serialization quirks.
- **Preload** allow-lists channel names (`INVOKE_CHANNELS`, `EVENT_CHANNELS`) and refuses anything else before touching `ipcRenderer`.
- **Renderer** calls `call('devices:list', null)` through `lib/api.ts`, which unwraps the envelope and throws a typed `ApiError` for the UI to display.

Main → renderer events are `logcat:lines`, `logcat:exit`, `scrcpy:exit` (batched and bounded — see `LogcatManager`) and `update:status` (a small `UpdateStatus` state object from the auto-updater).

## External process execution

`src/main/adb/run.ts` is the only place spawns happen:

- `runCommand(bin, argv, opts)` → `spawn(bin, argv, { shell: false, windowsHide: true })`, with timeout (default 15 s, SIGTERM → SIGKILL escalation), output caps (default 2 MiB, `truncated` flag), and structured errors (`TOOL_NOT_FOUND`, `INVALID_COMMAND`, `UNSAFE_ARGUMENT`).
- **Batch files** (`.bat`/`.cmd` — Flutter and the VS Code CLI on Windows) cannot be spawned directly on modern Node. `resolveExecutable()` routes them through `cmd.exe /d /s /c` with every token quoted, `windowsVerbatimArguments` (cmd does not understand backslash-escaped quotes), and a **metacharacter denylist** (`" % & | < > ^ ( ) !`) because batch scripts re-parse their own arguments. See `docs/security.md`.
- `spawnManaged()` is the long-lived variant used by logcat/scrcpy; both register in `ProcessRegistry`, which is stopped in `before-quit` so no orphan `adb logcat`/`scrcpy` survives the app.

## Tool location

`src/main/adb/locate.ts` resolves each tool in priority order and reports honestly (`available: false` + install hint when missing):

1. Explicit override env (`DROIDBRIDGE_*_PATH`)
2. SDK env vars (`ANDROID_HOME` / `ANDROID_SDK_ROOT`, `FLUTTER_ROOT`)
3. `PATH` scan (`.exe`, `.cmd`, `.bat` variants)
4. Well-known install locations — including a direct scan of winget's package store (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Genymobile.scrcpy_*`), so `winget install Genymobile.scrcpy` is detected even before the updated PATH reaches a running process; plus `%LOCALAPPDATA%\Android\Sdk\platform-tools` and per-user VS Code

All lookups are pure functions over an injectable `FileProbe`, which is what makes them unit-testable.

## Key services

- `services/devices.ts` — `listDevices` (`adb devices -l`), `getDeviceDetails` (parallel `getprop`, `dumpsys battery`, `df -k`, `/proc/meminfo`, `wm size/density`, `ip addr`, `getenforce`), `runDiagnostics` (turns live state into pass/warn/fail checks with hints), `rebootDevice`, `disconnectDevice`.
- `services/pairing.ts` — `adb pair` / `connect` / `disconnect`, `restartAdbServer` (kill-server + start-server), IPv6-aware endpoint formatting.
- `adb/logcat.ts` — session manager: max 4 concurrent sessions, `-T 1000` tail-then-follow, line parsing (`-v threadtime`), batching (200 lines / 250 ms) and a 64 KiB guard for unterminated chunks.
- `services/scrcpy.ts` — pure `buildScrcpyArgs` + managed launch/stop; missing scrcpy is an honest error with the winget command.
- `services/tools.ts` — system status probe, `flutter doctor -v`, `flutter devices`, `flutter pub get` (refuses folders without `pubspec.yaml`), VS Code open-folder.
- `services/exporter.ts` — the only writer of user-chosen files; path always comes from the native save dialog.
- `services/updater.ts` — auto-update policy: packaged builds only, checks the GitHub Releases feed at launch and every 4 h, auto-downloads, streams `UpdateStatus` on `update:status`, and refuses to quit into the installer until a download has fully completed. `electron-updater`'s `autoUpdater` is injected as a structural interface (`UpdaterLike`), so the policy is unit-tested without Electron.

## Renderer

State is intentionally light — no global store:

- `useDevices` polls `devices:list` every 4 s (pauses when the window is hidden).
- `useSystemStatus` loads toolchain status on demand.
- `useLogcat` owns one streaming session with a 5 000-line bounded buffer, pause/resume that keeps streaming in the background, and export.

Views are plain function components over `components/ui.tsx` primitives (`Button`, `Card`, `StatusPill`, `Field`, `EmptyState`) with Tailwind v4 tokens defined in `styles.css`.

## Build pipeline

- `scripts/build-main.mjs` — esbuild bundles main + preload (CJS, `external: ['electron', 'electron-updater']`, minified in prod). `electron-updater` stays external because it resolves `app-update.yml` from the packaged resources at runtime.
- `scripts/dev.mjs` — orchestrates esbuild watch + Vite dev server + Electron with `DROIDBRIDGE_DEV_SERVER_URL`; waits for the dev server before launching.
- `vite build` → `dist/renderer` (`base: './'` so `loadFile` works).
- `electron-builder` → NSIS x64 installer (`electron-builder.yml`), shipping `dist/**` + `package.json` + the production `node_modules` (just `electron-updater`) inside an asar.
- `publish: github` in `electron-builder.yml` embeds `app-update.yml` (the update feed: `Abdullah-584/droidbridge`, `releaseType: release`) and, when CI runs with `--publish always`, uploads the installer + blockmap + `latest.yml` as the GitHub Release for the tag. See `docs/releasing.md`.
