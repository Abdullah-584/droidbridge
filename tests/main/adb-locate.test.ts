import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findAdb,
  findFlutter,
  findScrcpy,
  findVSCode,
  findWingetScrcpy,
  whichSync,
  type FileProbe,
} from '../../src/main/adb/locate';

function probeFor(files: string[]): FileProbe {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return { isFile: (p) => set.has(p.toLowerCase()) };
}

const sep = path.sep;

describe('whichSync', () => {
  it('finds the first matching candidate on PATH', () => {
    const probe = probeFor([`C${sep}tools${sep}adb.exe`]);
    expect(whichSync(['adb.exe'], `C${sep}other;C${sep}tools`, probe)).toBe(`C${sep}tools${sep}adb.exe`);
  });

  it('returns null when nothing matches', () => {
    expect(whichSync(['adb.exe'], `C${sep}nothing`, probeFor([]))).toBeNull();
    expect(whichSync(['adb.exe'], undefined, probeFor([]))).toBeNull();
  });
});

describe('findAdb', () => {
  it('prefers the explicit override', () => {
    const env = { DROIDBRIDGE_ADB_PATH: `C${sep}custom${sep}adb.exe`, PATH: '' };
    const probe = probeOf(env.DROIDBRIDGE_ADB_PATH);
    expect(findAdb(env, probe)).toEqual({ path: env.DROIDBRIDGE_ADB_PATH, source: 'env' });
  });

  it('uses ANDROID_HOME platform-tools before PATH', () => {
    const env = {
      ANDROID_HOME: `C${sep}sdk`,
      PATH: `C${sep}pathbin`,
    };
    const probe = probeOf(
      `${env.ANDROID_HOME}${sep}platform-tools${sep}adb.exe`,
      `${env.PATH}${sep}adb.exe`,
    );
    expect(findAdb(env, probe)).toEqual({
      path: `${env.ANDROID_HOME}${sep}platform-tools${sep}adb.exe`,
      source: 'env',
    });
  });

  it('falls back to PATH then default locations', () => {
    const env = { PATH: `C${sep}pathbin`, LOCALAPPDATA: `C${sep}users${sep}me${sep}AppData${sep}Local` };
    const fromPath = probeOf(`${env.PATH}${sep}adb.exe`);
    expect(findAdb(env, fromPath)).toEqual({ path: `${env.PATH}${sep}adb.exe`, source: 'path' });

    const defaultPath = `${env.LOCALAPPDATA}${sep}Android${sep}Sdk${sep}platform-tools${sep}adb.exe`;
    expect(findAdb(env, probeOf(defaultPath))).toEqual({ path: defaultPath, source: 'default-location' });

    expect(findAdb(env, probeOf())).toEqual({ path: null, source: 'not-found' });
  });
});

describe('findFlutter / findScrcpy / findVSCode', () => {
  it('honours FLUTTER_ROOT', () => {
    const env = { FLUTTER_ROOT: `C${sep}flutter` };
    const bat = `${env.FLUTTER_ROOT}${sep}bin${sep}flutter.bat`;
    expect(findFlutter(env, probeOf(bat))).toEqual({ path: bat, source: 'env' });
  });

  it('finds scrcpy on PATH', () => {
    const env = { PATH: `C${sep}tools` };
    const exe = `${env.PATH}${sep}scrcpy.exe`;
    expect(findScrcpy(env, probeOf(exe))).toEqual({ path: exe, source: 'path' });
  });

  it('finds the VS Code CLI in the per-user install', () => {
    const env = { LOCALAPPDATA: `C${sep}AppData${sep}Local` };
    const cmd = `${env.LOCALAPPDATA}${sep}Programs${sep}Microsoft VS Code${sep}bin${sep}code.cmd`;
    expect(findVSCode(env, probeOf(cmd))).toEqual({ path: cmd, source: 'default-location' });
  });

  it('reports not-found honestly', () => {
    expect(findScrcpy({ PATH: '' }, probeOf())).toEqual({ path: null, source: 'not-found' });
  });
});

describe('winget package scan (scrcpy)', () => {
  const localAppData = `C${sep}Users${sep}me${sep}AppData${sep}Local`;
  const packagesDir = `${localAppData}${sep}Microsoft${sep}WinGet${sep}Packages`;
  const packageDir = `${packagesDir}${sep}Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe`;
  const nestedDir = `${packageDir}${sep}scrcpy-win64-v4.1`;
  const exe = `${nestedDir}${sep}scrcpy.exe`;

  function probeWithListing(files: string[], dirs: Record<string, string[]>): FileProbe {
    const base = probeFor(files);
    return {
      isFile: base.isFile,
      listDir: (dir) => {
        if (!(dir in dirs)) throw new Error(`ENOENT: ${dir}`);
        return dirs[dir];
      },
    };
  }

  it('finds scrcpy in the winget package store without any PATH change', () => {
    const probe = probeWithListing([exe], {
      [packagesDir]: ['Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe', 'Unrelated.Pkg'],
      [packageDir]: ['scrcpy-win64-v4.1'],
    });
    // PATH is empty on purpose: detection must not depend on a refreshed env.
    expect(findScrcpy({ PATH: '', LOCALAPPDATA: localAppData }, probe)).toEqual({
      path: exe,
      source: 'default-location',
    });
    expect(findWingetScrcpy(localAppData, probe)).toBe(exe);
  });

  it('supports a flat scrcpy.exe directly in the package folder', () => {
    const flat = `${packageDir}${sep}scrcpy.exe`;
    const probe = probeWithListing([flat], {
      [packagesDir]: ['Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe'],
      [packageDir]: ['scrcpy.exe'],
    });
    expect(findWingetScrcpy(localAppData, probe)).toBe(flat);
  });

  it('stays deterministic when the probe cannot list directories', () => {
    expect(findWingetScrcpy(localAppData, probeOf())).toBeNull();
    expect(findWingetScrcpy(undefined, probeOf())).toBeNull();
  });

  it('returns null when winget dirs are missing or package absent', () => {
    const empty = probeWithListing([], { [packagesDir]: [] });
    expect(findWingetScrcpy(localAppData, empty)).toBeNull();
    const noPkg = probeWithListing([], { [packagesDir]: ['Other.Thing'] });
    expect(findWingetScrcpy(localAppData, noPkg)).toBeNull();
  });
});

function probeOf(...files: string[]): FileProbe {
  return probeFor(files.filter(Boolean));
}
