# Testing DroidBridge

Runner: **Vitest** (`npm test`, config in `vitest.config.ts`). Layers follow the test pyramid; the suite is designed to run on any Windows dev machine with platform-tools installed — **no physical device is required**.

## Layers

### 1. Pure unit tests (node)

| File | Covers |
| --- | --- |
| `tests/shared/validation.test.ts` | Every boundary validator: serials, hosts (IPv4/IPv6/hostname, injection shapes), ports, pairing codes, project paths, external URLs, logcat/scrcpy options |
| `tests/main/adb-parse.test.ts` | Real `adb devices -l`, `getprop`, `dumpsys battery`, `df -k`, `/proc/meminfo`, `ip addr`, `logcat -v threadtime`, `flutter devices` output fixtures |
| `tests/main/adb-locate.test.ts` | Tool location priority (override → SDK env → PATH → winget package scan → default locations) with injected file probes |
| `tests/main/ipc-registry.test.ts` | Result envelope, error normalization, complete channel registration, per-channel payload validation |

### 2. Process-safety tests (node, real processes)

| File | Covers |
| --- | --- |
| `tests/main/adb-run.test.ts` | Exit codes, output caps, timeout kill, NUL rejection, **no-shell guarantee** (metacharacters arrive verbatim), batch quoting + metacharacter denylist, real `.cmd` fixture execution |
| `tests/main/process-registry.test.ts` | Track/stop/stopAll/remove semantics on real child processes |
| `tests/main/logcat-manager.test.ts` | Streaming: `.cmd` fixture emits threadtime lines → parsed, sequenced, batched, exit reported; stop() kills and cleans the registry |

### 3. Integration tests against real tools

`tests/integration/live-adb.test.ts`:

- runs the **real** `adb version` and `adb devices -l` through the safe runner and asserts the parsers agree with the service;
- asserts tool status never fabricates data (missing tool ⇒ `path: null` + install hint);
- runs the real `flutter --version` when a Flutter SDK is present (skipped otherwise);
- resolves scrcpy wherever it is installed (winget/PATH) and runs the real `scrcpy --version`, asserting the honest "not installed" result when absent.

These are the tests that prove "real ADB only". They intentionally pass with zero devices attached — device-dependent UI states are covered by fixtures and component tests.

### 4. Renderer tests (jsdom)

| File | Covers |
| --- | --- |
| `tests/renderer/format.test.ts` | Log filtering (level + regex/substring fallback, combined), state/level styling maps, duration/time formatting |
| `tests/renderer/ui.test.tsx` | Primitives (Button/StatusPill/EmptyState/Field), Sidebar navigation, **PairingView validation UX** (invalid port / missing host never reach IPC) with a stubbed bridge |

## Running

```bash
npm test              # full suite (~10 s warm)
npm run test:watch    # watch mode
npx vitest run tests/main/adb-run.test.ts    # one file
```

Notes:

- `tests/mocks/electron.ts` is aliased over `electron` so main-process modules import cleanly in tests (vitest.config.ts `resolve.alias`).
- Component tests opt into jsdom per file (`// @vitest-environment jsdom`) and must call `cleanup()` between renders (globals are disabled).
- Live integration tests skip gracefully when `flutter`/`scrcpy` are absent.

## What is deliberately not automated

- **Click-through of a real RSA authorization prompt** — device-side UI, cannot be scripted safely; covered by the honest `unauthorized` diagnostics path.
- **NSIS installer UI** — validated by building it (`npm run dist`) and installing on a machine; see docs/releasing.md.
- **scrcpy window interaction** — the launch/stop plumbing is unit-tested with the real binary's argv contract; the window itself is scrcpy's own GUI.

## Adding tests for a new IPC channel

1. Add the channel to `IpcInvokeMap` + `INVOKE_CHANNELS`.
2. Add validators + a handler spec; extend `tests/main/ipc-registry.test.ts` with a bad-payload case (expect `VALIDATION_ERROR`) and a good-payload validation case.
3. If it spawns anything, test argv construction as a pure function and execution through `runCommand` against a fixture.
