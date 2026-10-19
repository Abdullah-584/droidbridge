# Releasing DroidBridge (Windows x64)

## One command

```bash
npm run dist
```

This runs, in order:

1. `npm run typecheck` — strict TS across main/preload/renderer/tests
2. `npm run build:main` — esbuild bundles `dist/main/main.js` + `dist/preload/preload.cjs`
3. `npm run build:renderer` — Vite production build into `dist/renderer`
4. `electron-builder --win nsis --x64` — produces `release/DroidBridge-Setup-<version>-x64.exe`

For a fast local smoke test without the installer:

```bash
npm run dist:dir && npx electron release/win-unpacked/DroidBridge.exe
```

## Configuration

`electron-builder.yml`:

- **Target**: NSIS, x64 only, per-user install (no admin), install dir choosable, Start Menu + Desktop shortcuts, app data preserved on uninstall.
- **Payload**: only `dist/main/**`, `dist/preload/**`, `dist/renderer/**` and `package.json` inside an asar — no source, no source maps, no dev dependencies (the app has zero runtime npm dependencies).
- **Icon**: `build/icon.png` (256×256, regenerated with `node scripts/make-icon.mjs`); electron-builder derives the `.ico` automatically.

## Version bump

Bump `version` in `package.json` (semver), then `npm run dist`. The artifact name embeds the version: `DroidBridge-Setup-1.2.0-x64.exe`.

## Release checklist

- [ ] `npm run typecheck` and `npm test` pass on a clean checkout
- [ ] Live integration tests ran with real `adb` present
- [ ] Installer builds with no electron-builder errors (warnings about signing are expected until a cert is configured)
- [ ] Install → launch → dashboard shows real tool status and devices
- [ ] Logcat stream + export works against a real device
- [ ] Wireless pair/connect works against a real device
- [ ] Uninstall removes shortcuts and program files (keeps exported logs)

## Code signing (optional, recommended for distribution)

Unsigned installers trigger SmartScreen warnings. To sign, provide a certificate and set:

```bash
# electron-builder picks these up automatically
export CSC_LINK="path/to/certificate.pfx"   # or base64 contents
export CSC_KEY_PASSWORD="…"
```

or configure `win.certificateFile`/`win.certificateSubjectName` in `electron-builder.yml`. Never commit certificates or passwords.

## CI notes

A minimal Windows CI job:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 22 }
  - run: npm ci
  - run: npm run typecheck
  - run: npm test
  - run: npm run dist
  - uses: actions/upload-artifact@v4
    with: { name: droidbridge-installer, path: release/*.exe }
```

Platform-tools can be installed in CI (`setup-android` or a cached platform-tools zip) to enable the live adb integration tests; without them those tests fail loudly rather than silently skipping, so install them or exclude `tests/integration` explicitly.
