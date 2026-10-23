# DroidBridge Security Model

DroidBridge sits between a developer machine and connected Android devices. Its job is to make ADB workflows safer and more legible, not to widen the attack surface. This document lists the concrete guarantees and how each is enforced (and tested).

## Trust boundaries

```
untrusted input:          renderer (React, web tech)
                          device/adb output (third-party data)
                          user typing (serials, IPs, ports, codes, paths)
                                  │
                                  ▼  typed, allow-listed IPC
                          main process (Node)
                                  │
                                  ▼  spawn(bin, argv, { shell: false })
                          adb.exe / flutter.bat / scrcpy.exe / code.cmd / emulator.exe → USB/Wi-Fi devices
```

## Guarantee 1 — no shell command strings, ever

Every external process is started in `src/main/adb/run.ts` with `spawn(bin, argv, { shell: false })`. Arguments are individual argv entries; no value can ever be interpreted as shell syntax. `assertSafeArgv` additionally rejects NUL bytes.

**Batch-file caveat and mitigation.** Windows `.bat`/`.cmd` launchers (Flutter, VS Code CLI) can only be run through `cmd.exe`. cmd re-parses batch arguments (`%1` expansion), which historically enables injection even without shell metacharacters in the outer command line. Mitigations, all tested in `tests/main/adb-run.test.ts`:

- `resolveExecutable()` wraps the invocation as `cmd.exe /d /s /c ""bin" "arg1" "arg2""` with every token quoted, launched with `windowsVerbatimArguments` so Node's escaping cannot corrupt the line;
- `assertBatchSafeArg()` **rejects** `" % & | < > ^ ( ) !` and control characters in the binary path or any argument (`UNSAFE_ARGUMENT`), so no user value can change cmd's parsing;
- validated arguments (serials, hostnames, ports, paths) are additionally constrained by `src/shared/validation.ts` (e.g. serials `[A-Za-z0-9._:-]{1,64}`, absolute paths only).

## Guarantee 2 — Android authorization is never bypassed

- The app never writes to `~/.android`, never regenerates adb keys, never runs `adb usb`/`adb wireless` recovery tricks, and never touches `adbd` on-device.
- An `unauthorized` device is surfaced with guided steps ("unlock the phone, accept the RSA prompt") in the dashboard, devices view and diagnostics — never "fixed" silently.
- Pairing requires the six-digit code **shown on the device screen** (`adb pair ip:port code`); the code is validated (`^\d{6}$`) and passed as a single argv entry.

## Guarantee 3 — projects are read-only

- `flutter pub get` runs with the picked folder as `cwd` and refuses folders without a `pubspec.yaml`; VS Code integration only runs `code <folder>`. Neither writes, renames or deletes user files.
- Folder paths come from the native folder picker (`dialogs:pick-folder`); when a path does arrive over IPC it must be an absolute, control-character-free path (`assertProjectPath`).
- The only file DroidBridge writes on the user's behalf is the logcat export, and its path comes from the native save dialog (`services/exporter.ts`).
- The auto-updater writes only into its own application cache, and it downloads solely from the GitHub Releases feed baked in at build time (`app-update.yml`) — never from a user-controlled or response-controlled URL.

## Guarantee 4 — hardened renderer

Enforced in `src/main/index.ts` and `src/main/security.ts`:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`;
- strict **Content-Security-Policy** via `onHeadersReceived` (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`; dev mode additionally allows the Vite dev server);
- `will-navigate` blocked to anything but the app's own origin; `setWindowOpenHandler` denies popups and forwards http(s) links to the OS browser;
- all permission requests (camera, mic, geolocation, notifications, …) are denied.

## Guarantee 5 — validated, structured IPC

- The preload exposes exactly one namespace with an allow-list of channel names; unknown channels return `UNKNOWN_CHANNEL` without reaching `ipcMain`.
- Every handler validates its payload (`assertSerial`, `assertHost`, `assertPort`, `assertPairCode`, `assertLogcatOptions`, `assertScrcpyOptions`, `assertAvdName`, …) before any logic runs; failures come back as `{ ok: false, error: { code: 'VALIDATION_ERROR', … } }`.
- Hostnames accept IPv4 (octet-checked), IPv6 and DNS labels — and reject anything containing whitespace, control characters or shell metacharacters.

## Guarantee 6 — bounded resource use

- Every one-shot command has a timeout and output cap; logcat batches lines (200 / 250 ms) and caps concurrent sessions at 4.
- `ProcessRegistry` tracks every long-lived child and stops all of them (SIGTERM → SIGKILL) on quit — no orphaned `adb logcat`, `scrcpy` or emulator.
- The renderer log buffer is bounded (5 000 lines) and export payloads are size-checked (`assertLogLineBatch`).

## What DroidBridge deliberately does NOT do

- No auto-acceptance or replay of adb authorization.
- No `adb root`, `adb remount`, key regeneration or bootloader/recovery automation.
- No telemetry, no network calls of its own (only `shell.openExternal` for documentation links the user clicks).
- No arbitrary shell/terminal feature.

## Dependency & supply-chain notes

- One lockfile (`package-lock.json`); the app ships zero runtime npm dependencies (React is bundled into the renderer by Vite; the asar contains only `dist/**` + `package.json`).
- Dev-only toolchain: electron, electron-builder, vite, vitest, typescript, tailwind, testing-library. Review lockfile diffs on upgrade; keep `npm audit` triaged by reachability.

## Residual risks

| Risk | Status |
| --- | --- |
| A future batch wrapper (flutter.bat) internally expands `%1` unsafely | Mitigated: metacharacters never reach batch args |
| Malicious device returning hostile logcat text | Rendered as text only (React escaping), never `innerHTML`; export writes plain text |
| Future contributors adding a shell escape hatch | The spawn module is the single choke point; tests assert no-shell behavior |
