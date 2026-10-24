import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLATFORM_TOOLS_URL,
  bsdtarPath,
  createToolInstaller,
  findFileRecursive,
  pickScrcpyAsset,
  toolsRoot,
  wingetInstallArgs,
} from '../../src/main/services/installer';
import { DroidBridgeError } from '../../src/main/errors';
import type { InstallProgress } from '../../src/shared/types';
import type { RunResult } from '../../src/main/adb/run';

const okRun: RunResult = {
  code: 0,
  signal: null,
  stdout: 'ok',
  stderr: '',
  timedOut: false,
  truncated: false,
  killed: false,
  durationMs: 1,
};

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'droidbridge-installer-'));
}

describe('pure installer helpers', () => {
  it('builds the managed tools root under LOCALAPPDATA', () => {
    const env = { LOCALAPPDATA: path.join('base', 'AppData', 'Local') };
    expect(toolsRoot(env)).toBe(path.join(env.LOCALAPPDATA, 'DroidBridge', 'tools'));
  });

  it('picks the win64 asset from a GitHub release payload', () => {
    const url = 'https://github.com/Genymobile/scrcpy/releases/download/v3.3.3/scrcpy-win64-v3.3.3.zip';
    const release = {
      assets: [
        { name: 'scrcpy-linux-x86_64-v3.3.3.zip', browser_download_url: 'https://example.invalid/linux' },
        { name: 'scrcpy-win64-v3.3.3.zip', browser_download_url: url },
        { name: 'scrcpy-win32-v3.3.3.zip', browser_download_url: 'https://example.invalid/32' },
      ],
    };
    expect(pickScrcpyAsset(release)).toBe(url);
  });

  it('rejects unexpected release payloads instead of guessing a URL', () => {
    expect(() => pickScrcpyAsset(null)).toThrow(DroidBridgeError);
    expect(() => pickScrcpyAsset({ assets: 'nope' })).toThrow(/unexpected response/i);
    expect(() => pickScrcpyAsset({ assets: [{ name: 'source.zip', browser_download_url: 'x' }] })).toThrow(
      /no windows x64 scrcpy archive/i,
    );
  });

  it('builds a fixed, non-shell winget argv with an exact package id', () => {
    expect(wingetInstallArgs('flutter')).toEqual([
      'install',
      '--id',
      'Google.Flutter',
      '-e',
      '--silent',
      '--accept-source-agreements',
      '--accept-package-agreements',
      '--disable-interactivity',
    ]);
    expect(wingetInstallArgs('code')).toContain('Microsoft.VisualStudioCode');
    // Zip tools are never handed to winget.
    expect(() => wingetInstallArgs('adb')).toThrow(/cannot install/i);
    expect(() => wingetInstallArgs('scrcpy')).toThrow(/cannot install/i);
  });

  it('finds extracted binaries recursively with bounded depth', () => {
    const root = tmpRoot();
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'adb.exe'), 'bin');
    expect(findFileRecursive(root, 'adb.exe')).toBe(path.join(nested, 'adb.exe'));
    expect(findFileRecursive(root, 'missing.exe')).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves the zip-capable bsdtar instead of a PATH-shaded GNU tar', () => {
    if (process.platform !== 'win32') {
      expect(bsdtarPath({})).toBe('tar');
      return;
    }
    // SystemRoot exists on Windows → absolute System32 tar.exe.
    expect(bsdtarPath({ SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' })).toBe(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
    );
    // A bogus system root falls back rather than spawning a missing file.
    expect(bsdtarPath({ SystemRoot: 'Q:\\definitely-missing' })).toBe('tar');
  });
});

describe('createToolInstaller (zip tools)', () => {
  let root: string;
  let events: InstallProgress[];
  let runCalls: { bin: string; argv: readonly string[] }[];

  const collect = (p: InstallProgress): void => {
    events.push(p);
  };

  beforeEach(() => {
    root = tmpRoot();
    events = [];
    runCalls = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Fake download that writes a placeholder zip and reports progress. */
  const fakeDownload = async (
    _url: string,
    dest: string,
    onProgress: (received: number, total: number | null) => void,
  ): Promise<void> => {
    onProgress(50, 100);
    onProgress(100, 100);
    fs.writeFileSync(dest, 'zip');
  };

  function installerWith(overrides: Parameters<typeof createToolInstaller>[1]) {
    return createToolInstaller(collect, { root, ...overrides });
  }

  it('installs adb from the official archive into the managed dir', async () => {
    const urls: string[] = [];
    const installer = installerWith({
      download: async (url, dest, on) => {
        urls.push(url);
        await fakeDownload(url, dest, on);
      },
      extract: async (_zip, destDir) => {
        const dir = path.join(destDir, 'platform-tools');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adb.exe'), 'bin');
      },
      run: async (bin, argv) => {
        runCalls.push({ bin, argv });
        return okRun;
      },
    });

    await installer.install('adb');

    expect(urls).toEqual([PLATFORM_TOOLS_URL]);
    expect(fs.existsSync(path.join(root, 'platform-tools', 'adb.exe'))).toBe(true);
    // Verified by really running the installed binary.
    expect(runCalls).toEqual([
      { bin: path.join(root, 'platform-tools', 'adb.exe'), argv: ['version'] },
    ]);
    expect(events.map((e) => e.phase)).toEqual([
      'downloading',
      'downloading',
      'downloading',
      'extracting',
      'verifying',
      'done',
    ]);
    expect(events.at(-1)).toEqual({ tool: 'adb', phase: 'done', percent: 100 });
    // Staging is cleaned up.
    expect(fs.readdirSync(path.join(root, '.staging'))).toEqual([]);
  });

  it('installs scrcpy from the latest release asset', async () => {
    const urls: string[] = [];
    const installer = installerWith({
      download: async (url, dest, on) => {
        urls.push(url);
        await fakeDownload(url, dest, on);
      },
      fetchText: async () =>
        JSON.stringify({
          assets: [
            { name: 'scrcpy-win64-v3.3.3.zip', browser_download_url: 'https://example.invalid/scrcpy.zip' },
          ],
        }),
      extract: async (_zip, destDir) => {
        const dir = path.join(destDir, 'scrcpy-win64-v3.3.3');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'scrcpy.exe'), 'bin');
        fs.writeFileSync(path.join(dir, 'AdbWinApi.dll'), 'dll');
      },
      run: async (bin, argv) => {
        runCalls.push({ bin, argv });
        return okRun;
      },
    });

    await installer.install('scrcpy');

    expect(urls).toEqual(['https://example.invalid/scrcpy.zip']);
    // The whole extracted folder (exe + DLLs) is swapped into place.
    expect(fs.existsSync(path.join(root, 'scrcpy', 'scrcpy.exe'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scrcpy', 'AdbWinApi.dll'))).toBe(true);
    expect(runCalls[0]).toEqual({
      bin: path.join(root, 'scrcpy', 'scrcpy.exe'),
      argv: ['--version'],
    });
    expect(events.at(-1)?.phase).toBe('done');
  });

  it('emits an honest error and cleans staging when the download fails', async () => {
    const installer = installerWith({
      download: async () => {
        throw new Error('network down');
      },
      fetchText: async () =>
        JSON.stringify({
          assets: [
            { name: 'scrcpy-win64-v3.3.3.zip', browser_download_url: 'https://example.invalid/scrcpy.zip' },
          ],
        }),
      extract: async () => undefined,
      run: async () => okRun,
    });

    const failure = await installer.install('scrcpy').then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(DroidBridgeError);
    expect((failure as DroidBridgeError).message).toBe('network down');
    expect(events.at(-1)).toEqual({ tool: 'scrcpy', phase: 'error', percent: 0, message: 'network down' });
    expect(fs.readdirSync(path.join(root, '.staging'))).toEqual([]);
  });

  it('fails verification when the archive has no binary', async () => {
    const installer = installerWith({
      download: fakeDownload,
      extract: async (_zip, destDir) => {
        fs.mkdirSync(path.join(destDir, 'empty'), { recursive: true });
      },
      run: async () => okRun,
    });

    await expect(installer.install('adb')).rejects.toThrow(/did not contain adb\.exe/i);
    expect(events.at(-1)?.phase).toBe('error');
  });

  it('fails verification when the installed binary does not run', async () => {
    const installer = installerWith({
      download: fakeDownload,
      extract: async (_zip, destDir) => {
        const dir = path.join(destDir, 'platform-tools');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adb.exe'), 'bin');
      },
      run: async () => ({ ...okRun, code: 1, stdout: '', stderr: 'broken' }),
    });

    await expect(installer.install('adb')).rejects.toThrow(/failed to run/i);
    expect(events.at(-1)?.phase).toBe('error');
  });

  it('is single-flight: concurrent installs of one tool share one job', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const installer = installerWith({
      download: async (_url, dest, _on) => {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        fs.writeFileSync(dest, 'zip');
      },
      extract: async (_zip, destDir) => {
        const dir = path.join(destDir, 'platform-tools');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'adb.exe'), 'bin');
      },
      run: async () => okRun,
    });

    const first = installer.install('adb');
    const second = installer.install('adb');
    expect(second).toBe(first);
    await new Promise((r) => setTimeout(r, 10));
    gate.release?.();
    await first;
  });
});

describe('createToolInstaller (winget + auto-install)', () => {
  let root: string;
  let events: InstallProgress[];

  beforeEach(() => {
    root = tmpRoot();
    events = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('installs Flutter silently through winget', async () => {
    const calls: { bin: string; argv: readonly string[] }[] = [];
    const installer = createToolInstaller(
      (p) => events.push(p),
      {
        root,
        run: async (bin, argv) => {
          calls.push({ bin, argv });
          return okRun;
        },
      },
    );

    await installer.install('flutter');

    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe('winget');
    expect(calls[0].argv).toContain('Google.Flutter');
    expect(calls[0].argv).toContain('--silent');
    expect(events.map((e) => e.phase)).toEqual(['installing', 'done']);
  });

  it('surfaces the winget failure output instead of claiming success', async () => {
    const installer = createToolInstaller(
      (p) => events.push(p),
      {
        root,
        run: async () => ({ ...okRun, code: 1, stdout: '', stderr: 'error 0x80070005: access denied' }),
      },
    );

    await expect(installer.install('code')).rejects.toThrow(/access denied/i);
    expect(events.at(-1)).toMatchObject({ tool: 'code', phase: 'error', message: expect.stringContaining('access denied') });
  });

  it('reports a missing winget honestly', async () => {
    const installer = createToolInstaller(
      (p) => events.push(p),
      {
        root,
        run: async () => {
          throw new Error('spawn winget ENOENT');
        },
      },
    );

    await expect(installer.install('code')).rejects.toThrow(/ENOENT/);
    expect(events.at(-1)?.phase).toBe('error');
  });

  it('auto-installs only adb and scrcpy when missing — never flutter', async () => {
    const probed: string[] = [];
    const installer = createToolInstaller(
      (p) => events.push(p),
      {
        root,
        locate: (tool) => {
          probed.push(tool);
          return { path: tool === 'scrcpy' ? 'C:\\scrcpy\\scrcpy.exe' : null };
        },
        download: async (_url, dest, on) => {
          on(100, 100);
          fs.writeFileSync(dest, 'zip');
        },
        extract: async (_zip, destDir) => {
          const dir = path.join(destDir, 'platform-tools');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'adb.exe'), 'bin');
        },
        run: async () => okRun,
        fetchText: async () => JSON.stringify({ assets: [] }),
      },
    );

    await installer.autoInstallMissing();

    // Only the two auto tools are even probed.
    expect(probed).toEqual(['adb', 'scrcpy']);
    // scrcpy was present → only adb was installed.
    expect(fs.existsSync(path.join(root, 'platform-tools', 'adb.exe'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scrcpy'))).toBe(false);
    expect(events.filter((e) => e.phase === 'done').map((e) => e.tool)).toEqual(['adb']);
  });

  it('does nothing when adb and scrcpy are already available', async () => {
    let downloads = 0;
    const installer = createToolInstaller(
      (p) => events.push(p),
      {
        root,
        locate: () => ({ path: 'C:\\already\\there.exe' }),
        download: async (_url, dest, _on) => {
          downloads += 1;
          fs.writeFileSync(dest, 'zip');
        },
        extract: async () => undefined,
        run: async () => okRun,
      },
    );

    await installer.autoInstallMissing();
    expect(downloads).toBe(0);
    expect(events).toEqual([]);
  });
});
