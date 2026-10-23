import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findAdb,
  findEmulator,
  findFlutter,
  findScrcpy,
  findVSCode,
  findWingetScrcpy,
  parseRegQueryValue,
  whichSync,
  type FileProbe,
  type RegReader,
} from '../../src/main/adb/locate';

function probeFor(files: string[]): FileProbe {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return { isFile: (p) => set.has(p.toLowerCase()) };
}

const sep = path.sep;
/** Platform-correct adb binary name so these tests run on Windows and macOS CI. */
const ADB = process.platform === 'win32' ? 'adb.exe' : 'adb';
/** Hermetic default: no registry data unless a test injects a fake reader. */
const noReg: RegReader = () => null;

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
    const env = { DROIDBRIDGE_ADB_PATH: `C${sep}custom${sep}${ADB}`, PATH: '' };
    const probe = probeOf(env.DROIDBRIDGE_ADB_PATH);
    expect(findAdb(env, probe, noReg)).toEqual({ path: env.DROIDBRIDGE_ADB_PATH, source: 'env' });
  });

  it('uses ANDROID_HOME platform-tools before PATH', () => {
    const env = {
      ANDROID_HOME: `C${sep}sdk`,
      PATH: `C${sep}pathbin`,
    };
    const probe = probeOf(
      `${env.ANDROID_HOME}${sep}platform-tools${sep}${ADB}`,
      `${env.PATH}${sep}${ADB}`,
    );
    expect(findAdb(env, probe, noReg)).toEqual({
      path: `${env.ANDROID_HOME}${sep}platform-tools${sep}${ADB}`,
      source: 'env',
    });
  });

  it('falls back to PATH then default locations', () => {
    const env = { PATH: `C${sep}pathbin`, LOCALAPPDATA: `C${sep}users${sep}me${sep}AppData${sep}Local` };
    const fromPath = probeOf(`${env.PATH}${sep}${ADB}`);
    expect(findAdb(env, fromPath, noReg)).toEqual({ path: `${env.PATH}${sep}${ADB}`, source: 'path' });

    const defaultPath = `${env.LOCALAPPDATA}${sep}Android${sep}Sdk${sep}platform-tools${sep}${ADB}`;
    expect(findAdb(env, probeOf(defaultPath), noReg)).toEqual({ path: defaultPath, source: 'default-location' });

    expect(findAdb(env, probeOf(), noReg)).toEqual({ path: null, source: 'not-found' });
  });
});

describe('findAdb registry lookup', () => {
  const sdk = `C${sep}Users${sep}me${sep}AppData${sep}Local${sep}Android${sep}Sdk`;
  const registeredAdb = `${sdk}${sep}platform-tools${sep}${ADB}`;

  it('prefers the registry over ANDROID_HOME and PATH', () => {
    const env = { ANDROID_HOME: `C${sep}other-sdk`, PATH: `C${sep}pathbin` };
    // Both the registry location AND the env/PATH locations exist in the probe;
    // the registry must still win.
    const probe = probeOf(
      registeredAdb,
      `${env.ANDROID_HOME}${sep}platform-tools${sep}${ADB}`,
      `${env.PATH}${sep}${ADB}`,
    );
    const readReg: RegReader = (key) => (key.includes('HKCU') ? sdk : null);
    expect(findAdb(env, probe, readReg)).toEqual({ path: registeredAdb, source: 'registry' });
  });

  it('consults keys in order and stops at the first hit', () => {
    const queried: string[] = [];
    const readReg: RegReader = (key) => {
      queried.push(key);
      return key.startsWith('HKLM\\SOFTWARE') && !key.includes('WOW6432Node') ? sdk : null;
    };
    const found = findAdb({ PATH: '' }, probeOf(registeredAdb), readReg);
    expect(found).toEqual({ path: registeredAdb, source: 'registry' });
    // HKCU first, then HKLM; the 32-bit view is only consulted after a miss.
    expect(queried[0]).toContain('HKCU');
    expect(queried[1]).toContain('HKLM');
    expect(queried.some((k) => k.includes('WOW6432Node'))).toBe(false);
  });

  it('consults the 32-bit registry view when the 64-bit keys miss', () => {
    const queried: string[] = [];
    const readReg: RegReader = (key) => {
      queried.push(key);
      return key.includes('WOW6432Node') ? sdk : null;
    };
    expect(findAdb({ PATH: '' }, probeOf(registeredAdb), readReg)).toEqual({
      path: registeredAdb,
      source: 'registry',
    });
    expect(queried.some((k) => k.includes('WOW6432Node'))).toBe(true);
  });

  it('accepts a Path value that points directly at platform-tools', () => {
    const platformTools = `C${sep}sdk${sep}platform-tools`;
    const direct = `${platformTools}${sep}${ADB}`;
    const readReg: RegReader = () => platformTools;
    expect(findAdb({ PATH: '' }, probeOf(direct), readReg)).toEqual({ path: direct, source: 'registry' });
  });

  it('falls through to env/PATH when the registry path has no adb', () => {
    const env = { PATH: `C${sep}pathbin` };
    // Registry returns a directory that exists, but contains no adb binary.
    expect(findAdb(env, probeOf(`${env.PATH}${sep}${ADB}`), () => `C${sep}empty-sdk`)).toEqual({
      path: `${env.PATH}${sep}${ADB}`,
      source: 'path',
    });
  });

  it('reports not-found when the registry has no SDK key at all', () => {
    expect(findAdb({ PATH: '' }, probeOf(), () => null)).toEqual({ path: null, source: 'not-found' });
  });
});

describe('parseRegQueryValue', () => {
  it('extracts a REG_SZ value from real `reg query` output', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Android SDK Tools',
      '    Path    REG_SZ    C:\\Users\\me\\AppData\\Local\\Android\\Sdk',
      '',
    ].join('\r\n');
    expect(parseRegQueryValue(output, 'Path')).toBe('C:\\Users\\me\\AppData\\Local\\Android\\Sdk');
  });

  it('handles REG_EXPAND_SZ and ignores other value names', () => {
    const output =
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Android SDK Tools\r\n    Path    REG_EXPAND_SZ    %LOCALAPPDATA%\\Android\\Sdk\r\n    Other    REG_DWORD    0x1\r\n';
    expect(parseRegQueryValue(output, 'Path')).toBe('%LOCALAPPDATA%\\Android\\Sdk');
    expect(parseRegQueryValue(output, 'Missing')).toBeNull();
  });

  it('returns null for empty or unrelated output', () => {
    expect(parseRegQueryValue('', 'Path')).toBeNull();
    expect(parseRegQueryValue('ERROR: The system was unable to find the specified registry key or value.', 'Path')).toBeNull();
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
    const exe = `${env.PATH}${sep}${process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy'}`;
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

describe('findEmulator', () => {
  /** Platform-correct emulator binary name (Windows CI and macOS CI both run these). */
  const EMULATOR = process.platform === 'win32' ? 'emulator.exe' : 'emulator';

  it('prefers the explicit override', () => {
    const env = { DROIDBRIDGE_EMULATOR_PATH: `C${sep}custom${sep}${EMULATOR}`, PATH: '' };
    expect(findEmulator(env, probeOf(env.DROIDBRIDGE_EMULATOR_PATH), noReg)).toEqual({
      path: env.DROIDBRIDGE_EMULATOR_PATH,
      source: 'env',
    });
  });

  it('uses the SDK registry path before env vars and PATH', () => {
    const sdk = `C${sep}sdk`;
    const env = { ANDROID_HOME: `C${sep}other-sdk`, PATH: `C${sep}pathbin` };
    const probe = probeOf(
      `${sdk}${sep}emulator${sep}${EMULATOR}`,
      `${env.ANDROID_HOME}${sep}emulator${sep}${EMULATOR}`,
      `${env.PATH}${sep}${EMULATOR}`,
    );
    const readReg: RegReader = () => sdk;
    expect(findEmulator(env, probe, readReg)).toEqual({
      path: `${sdk}${sep}emulator${sep}${EMULATOR}`,
      source: 'registry',
    });
  });

  it('resolves a platform-tools registry Path through its parent directory', () => {
    const platformTools = `C${sep}sdk${sep}platform-tools`;
    const emu = `C${sep}sdk${sep}emulator${sep}${EMULATOR}`;
    expect(findEmulator({ PATH: '' }, probeOf(emu), () => platformTools)).toEqual({
      path: emu,
      source: 'registry',
    });
  });

  it('accepts the legacy SDK tools/ directory from the registry', () => {
    const sdk = `C${sep}sdk`;
    const legacy = `${sdk}${sep}tools${sep}${EMULATOR}`;
    expect(findEmulator({ PATH: '' }, probeOf(legacy), () => sdk)).toEqual({
      path: legacy,
      source: 'registry',
    });
  });

  it('uses ANDROID_HOME / ANDROID_SDK_ROOT before PATH', () => {
    const env = { ANDROID_SDK_ROOT: `C${sep}sdk`, PATH: `C${sep}pathbin` };
    const probe = probeOf(
      `${env.ANDROID_SDK_ROOT}${sep}emulator${sep}${EMULATOR}`,
      `${env.PATH}${sep}${EMULATOR}`,
    );
    expect(findEmulator(env, probe, noReg)).toEqual({
      path: `${env.ANDROID_SDK_ROOT}${sep}emulator${sep}${EMULATOR}`,
      source: 'env',
    });
  });

  it('falls back to PATH then default SDK locations', () => {
    const env = { PATH: `C${sep}pathbin`, LOCALAPPDATA: `C${sep}users${sep}me${sep}AppData${sep}Local` };
    expect(findEmulator(env, probeOf(`${env.PATH}${sep}${EMULATOR}`), noReg)).toEqual({
      path: `${env.PATH}${sep}${EMULATOR}`,
      source: 'path',
    });

    const defaultPath = `${env.LOCALAPPDATA}${sep}Android${sep}Sdk${sep}emulator${sep}${EMULATOR}`;
    expect(findEmulator(env, probeOf(defaultPath), noReg)).toEqual({
      path: defaultPath,
      source: 'default-location',
    });

    expect(findEmulator(env, probeOf(), noReg)).toEqual({ path: null, source: 'not-found' });
  });

  it('finds the emulator under the user home SDK directories (macOS/Linux defaults)', () => {
    const home = `C${sep}home${sep}dev`;
    const macPath = `${home}${sep}Library${sep}Android${sep}sdk${sep}emulator${sep}${EMULATOR}`;
    expect(findEmulator({ HOME: home, PATH: '' }, probeOf(macPath), noReg)).toEqual({
      path: macPath,
      source: 'default-location',
    });

    const linuxPath = `${home}${sep}Android${sep}Sdk${sep}emulator${sep}${EMULATOR}`;
    expect(findEmulator({ HOME: home, PATH: '' }, probeOf(linuxPath), noReg)).toEqual({
      path: linuxPath,
      source: 'default-location',
    });
  });
});
