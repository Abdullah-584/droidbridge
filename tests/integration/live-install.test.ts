import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolInstaller } from '../../src/main/services/installer';
import type { InstallProgress } from '../../src/shared/types';

/**
 * Live install tests: real HTTPS downloads from Google/GitHub, real `tar`
 * extraction and a real version probe of the installed binary — into a temp
 * root that never touches the user's managed tools dir.
 *
 * Runs on CI (every release gates on it) and locally when
 * `DROIDBRIDGE_LIVE_INSTALL=1 npm test` is used; plain local runs skip the
 * network dependency.
 */
const enabled = process.env.CI === 'true' || process.env.DROIDBRIDGE_LIVE_INSTALL === '1';

const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';

describe.runIf(enabled)('live tool install', () => {
  let root: string;
  let events: InstallProgress[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'droidbridge-live-install-'));
    events = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it(
    'downloads the official platform-tools zip and installs a working adb',
    async () => {
      const installer = createToolInstaller((p) => events.push(p), { root });
      await installer.install('adb');

      const exe = path.join(root, 'platform-tools', EXE);
      expect(fs.existsSync(exe)).toBe(true);
      // The installer itself probes the binary; the final event must be done.
      expect(events.at(-1)).toMatchObject({ tool: 'adb', phase: 'done', percent: 100 });
      expect(events.some((e) => e.phase === 'downloading' && e.percent === 99)).toBe(true);
      // Staging cleaned — only the real install remains.
      expect(fs.readdirSync(path.join(root, '.staging'))).toEqual([]);
    },
    180_000,
  );

  it(
    'resolves the latest scrcpy release asset and installs a working scrcpy',
    async () => {
      const installer = createToolInstaller((p) => events.push(p), { root });
      await installer.install('scrcpy');

      const exe = path.join(root, 'scrcpy', process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy');
      expect(fs.existsSync(exe)).toBe(true);
      expect(events.at(-1)).toMatchObject({ tool: 'scrcpy', phase: 'done' });
    },
    180_000,
  );
});
