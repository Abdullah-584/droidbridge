# Releasing DroidBridge (Windows x64)

## Cutting a release — GitHub Actions (recommended)

`.github/workflows/release.yml` builds the installer and publishes it to
[GitHub Releases](https://github.com/Abdullah-584/droidbridge/releases)
automatically. Three paths, same result:

**0. Automatic (default)** — push any **code** change to `main` (`src/`, `scripts/`,
`tests/`, package files, workflow config): the workflow bumps the patch version
itself (e.g. `1.0.1 → 1.0.2`), commits it to `main`, then builds and publishes.
README/docs-only pushes are filtered out by the workflow's `paths:` list and
never burn a version.

**1. One click** — GitHub → *Actions → Release → Run workflow*:
the workflow bumps the patch version itself (e.g. `1.0.0 → 1.0.1`), commits it
to `main`, then builds and publishes.

**2. Tag push** — locally:

```bash
npm version patch        # bumps package.json + lockfile, commits, tags v1.0.1
git push --follow-tags   # the v* tag triggers the workflow
```

All paths then:

1. A `decide` job decides whether this run should publish at all — it skips our
   own `release vX.Y.Z` bump commits and pushes whose HEAD commit is already
   tagged (the follow-tags flow lets the tag run own that version), so a
   version is never released twice. Pushes made with the workflow's own
   `GITHUB_TOKEN` (the in-run bump and electron-builder's tag push) never
   re-trigger workflows at all — GitHub's recursion rule.
2. Installs Android platform-tools on the runner (the live `adb` tests need a real `adb`);
3. `npm ci` → `npm test` — the full suite is a hard gate, no release on red
   (with `CI=true`, so the **live install tests** — real HTTPS download +
   extraction of adb/scrcpy — run on every release too);
4. `npm run dist -- --publish always` — typecheck, esbuild, Vite, NSIS build, then upload of
   `DroidBridge-Setup-<version>-x64.exe`, its `.blockmap` and **`latest.yml`** to the release
   for the `v<version>` tag (`releaseType: release`, so it is public immediately — installed
   clients ignore drafts);
5. `node scripts/verify-release.mjs` — the **duplicate-release guard**: proves the tag has
   exactly one release holding exe + blockmap + `latest.yml`, that `latest.yml`'s version and
   byte size match the uploaded exe, and repairs a split-asset duplicate (copy missing assets,
   delete the empty twin) when electron-builder's parallel uploads race each other — failing
   the run loudly otherwise;
6. Uploads the installer as a workflow artifact too, for convenience.

No secrets to configure: the workflow uses the built-in `GITHUB_TOKEN`
(`permissions: contents: write` is already set).

The guard can also be run locally (read-only diagnosis, anonymous API):

```bash
node scripts/verify-release.mjs --check
```

### Rules the updater depends on

- **The version must increase.** Clients compare their installed version against the release;
  rebuilding the same version never produces an update.
- **Tag ↔ package.json ↔ release must match** (`1.0.1` ↔ `v1.0.1`); both workflow paths
  guarantee this.
- **Releases must be published, not drafts** — configured via `releaseType: release`.

## Auto-update behavior (installed clients)

`src/main/services/updater.ts` + `electron-updater`:

- Only **packaged** builds ever talk to the feed — `npm run dev` stays silent.
- A check runs at launch and every **4 hours**; `autoDownload` is on.
- When a download completes the renderer shows a banner: **Restart now** applies the
  update **silently in the background** — the NSIS installer runs with `/S` (no setup
  wizard, no user input) and the new version reopens itself — or **Later** (the update
  still installs silently on quit — `autoInstallOnAppQuit`). The user never runs the
  setup again by hand.
- Failures surface honestly: the status stream carries `{ state: 'error' }`, and a failed
  restart attempt renders its message in the banner instead of failing silently.
- The feed URL is `app-update.yml`, embedded by electron-builder from the `publish` block —
  never set at runtime.

Local end-to-end check (optional): install the current build, publish a higher version to a
**draft release on a throwaway repo copy** or use `dev-app-update.yml` +
`autoUpdater.forceDevUpdateConfig`, then verify the banner appears. Testing against a real
installed app on Windows is the authoritative path.

## Local build (one command)

```bash
npm run dist
```

This runs, in order:

1. `npm run typecheck` — strict TS across main/preload/renderer/tests
2. `npm run build:main` — esbuild bundles `dist/main/main.js` + `dist/preload/preload.cjs`
   (`electron-updater` is external: it resolves `app-update.yml` at runtime)
3. `npm run build:renderer` — Vite production build into `dist/renderer`
4. `electron-builder --win nsis --x64` — produces `release/DroidBridge-Setup-<version>-x64.exe`

For a fast local smoke test without the installer:

```bash
npm run dist:dir && npx electron release/win-unpacked/DroidBridge.exe
```

`release/win-unpacked/resources/app-update.yml` must exist — its absence means the
`publish` config was dropped and the packaged app will not receive updates.

## Configuration

`electron-builder.yml`:

- **Target**: NSIS, x64 only, per-user install (no admin), install dir choosable, Start Menu + Desktop shortcuts, app data preserved on uninstall.
- **Payload**: `dist/main/**`, `dist/preload/**`, `dist/renderer/**`, `package.json` and the production `node_modules` (only `electron-updater`) inside an asar — no source, no source maps, no dev dependencies.
- **Publish**: `provider: github`, `owner: Abdullah-584`, `repo: droidbridge`, `releaseType: release` — generates `app-update.yml` in the package and is the target for `--publish always`.
- **`win.verifyUpdateCodeSignature: false`**: the build ships unsigned (no certificate), and electron-updater would otherwise reject an unsigned installer during update verification.
- **Icon**: `build/icon.png` (256×256, regenerated with `node scripts/make-icon.mjs`); electron-builder derives the `.ico` automatically.

## Version bump

Automated paths above handle it. For a manual build: bump `version` in `package.json` (semver), then `npm run dist`. The artifact name embeds the version: `DroidBridge-Setup-1.2.0-x64.exe`.

## Release checklist

- [ ] `npm run typecheck` and `npm test` pass on a clean checkout (the workflow re-runs both)
- [ ] Live integration tests ran with real `adb` present
- [ ] GitHub release exists for the tag, is **published**, and contains the `.exe`, `.blockmap` **and `latest.yml`**
- [ ] Release version > previously released version
- [ ] Install → launch → dashboard shows real tool status and devices
- [ ] Installed older build detects the new release: banner appears → **Restart now** updates it
- [ ] Logcat stream + export works against a real device
- [ ] Wireless pair/connect works against a real device
- [ ] Uninstall removes shortcuts and program files (keeps exported logs)

## Code signing (optional, recommended for distribution)

Unsigned installers trigger SmartScreen warnings, and users must trust "unknown publisher"
on every install and update. To sign, provide a certificate and set:

```bash
# electron-builder picks these up automatically
export CSC_LINK="path/to/certificate.pfx"   # or base64 contents
export CSC_KEY_PASSWORD="…"
```

or configure `win.certificateFile`/`win.certificateSubjectName` in `electron-builder.yml`.
Never commit certificates or passwords. When a certificate is added, drop
`verifyUpdateCodeSignature: false` so clients verify the publisher of every update.

## CI notes

The real pipeline lives in `.github/workflows/release.yml` (windows-latest, Node 24,
platform-tools installed for the live tests). Push to `main` publishes **only when code
paths changed** (see the `paths:` filter); docs/README edits, our own bump commits and
already-tagged commits are skipped by the `decide` job. Only a `v*` tag or a manual
dispatch bypasses nothing — they always release.
