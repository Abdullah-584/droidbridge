import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ToolName, ToolSource } from '../../shared/types';

export interface LocateResult {
  path: string | null;
  source: ToolSource;
}

// ---------------------------------------------------------------------------
// Windows registry (Android SDK installer's own record of the SDK path)
// ---------------------------------------------------------------------------

/** Reads a named value from a registry key; returns null when absent/unreadable. */
export type RegReader = (key: string, valueName: string) => string | null;

/** Keys the Android SDK installer writes, most specific first (64-bit view last). */
export const ADB_REG_KEYS = [
  'HKCU\\Software\\Android SDK Tools',
  'HKLM\\SOFTWARE\\Android SDK Tools',
  'HKLM\\SOFTWARE\\WOW6432Node\\Android SDK Tools',
] as const;

/**
 * Extracts one value from `reg query <key>` output. Handles both REG_SZ and
 * REG_EXPAND_SZ (the SDK installer has used either); returns null when the
 * value is absent or the input is an error message.
 */
export function parseRegQueryValue(output: string, valueName: string): string | null {
  const pattern = new RegExp(
    `^\\s*${valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`,
    'mi',
  );
  const match = pattern.exec(output);
  return match ? match[1] : null;
}

/**
 * Production registry reader: `reg.exe query <key> /v <name>` with argv (never
 * a shell), a short timeout, and a null on any failure — a missing key is the
 * normal case on machines without the SDK, not an error.
 */
export const queryWindowsRegistry: RegReader = (key, valueName) => {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('reg', ['query', key, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseRegQueryValue(output, valueName);
  } catch {
    return null;
  }
};

export interface FileProbe {
  isFile(absolutePath: string): boolean;
  /** Optional directory listing (names only) — used to scan winget packages. */
  listDir?(dirPath: string): string[];
}

/** Real-filesystem probe used by production lookups (tests inject their own). */
export const defaultFileProbe: FileProbe = {
  isFile(p: string): boolean {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  listDir(p: string): string[] {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
};

/** Searches the PATH environment variable for any of the candidate names. */
export function whichSync(candidateNames: readonly string[], pathValue: string | undefined, probe: FileProbe): string | null {
  if (!pathValue) return null;
  const dirs = pathValue.split(path.delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    for (const name of candidateNames) {
      const candidate = path.join(dir.replace(/"/g, ''), name);
      if (probe.isFile(candidate)) return candidate;
    }
  }
  return null;
}

function firstExisting(candidates: readonly string[], probe: FileProbe): string | null {
  for (const candidate of candidates) {
    if (candidate && probe.isFile(candidate)) return candidate;
  }
  return null;
}

function windowsNames(base: string, extraExts: readonly string[] = []): string[] {
  if (process.platform !== 'win32') return [base];
  return [`${base}.exe`, `${base}.cmd`, `${base}.bat`, ...extraExts];
}

function join(...parts: string[]): string {
  return path.join(...parts.filter(Boolean));
}

/**
 * Finds the ADB executable: override → Windows registry → SDK env vars →
 * PATH → default SDK dir.
 *
 * The registry check comes before the env vars because it records where the
 * SDK installer actually put the SDK — a stale ANDROID_HOME in a long-lived
 * shell (or a launched-from-Explorer app that never saw the user env) is the
 * exact failure this lookup fixes.
 */
export function findAdb(
  env: NodeJS.ProcessEnv,
  probe: FileProbe,
  readReg: RegReader = queryWindowsRegistry,
): LocateResult {
  const override = env.DROIDBRIDGE_ADB_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

  // The SDK installer writes its root (or platform-tools dir) here.
  for (const key of ADB_REG_KEYS) {
    const sdkPath = readReg(key, 'Path');
    if (!sdkPath) continue;
    const candidate = firstExisting(
      [join(sdkPath, 'platform-tools', windowsNames('adb')[0]), join(sdkPath, windowsNames('adb')[0])],
      probe,
    );
    if (candidate) return { path: candidate, source: 'registry' };
  }

  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT'] as const) {
    const sdk = env[key];
    if (sdk) {
      const candidate = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
      if (probe.isFile(candidate)) return { path: candidate, source: 'env' };
    }
  }

  const fromPath = whichSync(windowsNames('adb'), env.PATH, probe);
  if (fromPath) return { path: fromPath, source: 'path' };

  const localAppData = env.LOCALAPPDATA;
  const defaults = [
    localAppData ? join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe') : '',
    'C:\\Android\\platform-tools\\adb.exe',
  ];
  const fromDefault = firstExisting(defaults, probe);
  if (fromDefault) return { path: fromDefault, source: 'default-location' };

  return { path: null, source: 'not-found' };
}

/** The SDK ships `emulator.exe` on Windows and `emulator` elsewhere. */
function emulatorName(): string {
  return process.platform === 'win32' ? 'emulator.exe' : 'emulator';
}

/**
 * Finds the Android emulator binary: override → SDK registry → SDK env vars →
 * PATH → default SDK locations.
 *
 * The emulator ships as its own SDK package ("Emulator" in the SDK Manager),
 * not inside platform-tools — so the lookup probes `<sdk>/emulator/` plus the
 * legacy `<sdk>/tools/` layout, and derives the SDK root when the registry
 * points at the platform-tools directory. It is not part of `findTool`:
 * DroidBridge runs fine without it, so its absence must never surface as a
 * toolchain problem for adb/Flutter/scrcpy/code.
 */
export function findEmulator(
  env: NodeJS.ProcessEnv = process.env,
  probe: FileProbe = defaultFileProbe,
  readReg: RegReader = queryWindowsRegistry,
): LocateResult {
  const override = env.DROIDBRIDGE_EMULATOR_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

  const name = emulatorName();
  const sdkCandidates = (sdkPath: string): string[] => [
    join(sdkPath, 'emulator', name),
    join(sdkPath, 'tools', name), // legacy SDK layout (pre-25)
  ];

  for (const key of ADB_REG_KEYS) {
    const sdkPath = readReg(key, 'Path');
    if (!sdkPath) continue;
    // The registry may record the SDK root or its platform-tools directory.
    const candidate = firstExisting(
      [...sdkCandidates(sdkPath), join(sdkPath, '..', 'emulator', name)],
      probe,
    );
    if (candidate) return { path: candidate, source: 'registry' };
  }

  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT'] as const) {
    const sdk = env[key];
    if (!sdk) continue;
    const candidate = firstExisting(sdkCandidates(sdk), probe);
    if (candidate) return { path: candidate, source: 'env' };
  }

  const fromPath = whichSync(windowsNames('emulator'), env.PATH, probe);
  if (fromPath) return { path: fromPath, source: 'path' };

  const localAppData = env.LOCALAPPDATA;
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const fromDefault = firstExisting([
    localAppData ? join(localAppData, 'Android', 'Sdk', 'emulator', name) : '',
    join(home, 'Library', 'Android', 'sdk', 'emulator', name), // macOS
    join(home, 'Android', 'Sdk', 'emulator', name), // Linux
  ], probe);
  if (fromDefault) return { path: fromDefault, source: 'default-location' };

  return { path: null, source: 'not-found' };
}

/** Finds the Flutter SDK launcher: override → FLUTTER_ROOT → PATH → default. */
export function findFlutter(env: NodeJS.ProcessEnv, probe: FileProbe): LocateResult {
  const override = env.DROIDBRIDGE_FLUTTER_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

  const root = env.FLUTTER_ROOT;
  if (root) {
    const candidate = firstExisting(
      [join(root, 'bin', 'flutter'), join(root, 'bin', 'flutter.bat')],
      probe,
    );
    if (candidate) return { path: candidate, source: 'env' };
  }

  const fromPath = whichSync(windowsNames('flutter'), env.PATH, probe);
  if (fromPath) return { path: fromPath, source: 'path' };

  const home = env.USERPROFILE ?? env.HOME ?? '';
  const fromDefault = firstExisting(
    [join(home, 'flutter', 'bin', 'flutter'), join(home, 'flutter', 'bin', 'flutter.bat'), join('C:\\', 'flutter', 'bin', 'flutter.bat')],
    probe,
  );
  if (fromDefault) return { path: fromDefault, source: 'default-location' };

  return { path: null, source: 'not-found' };
}

/**
 * Locates scrcpy inside winget's package store
 * (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Genymobile.scrcpy_*\scrcpy-*\scrcpy.exe`).
 *
 * winget rewrites the user PATH, but long-running processes (and freshly
 * installed tools) keep the old environment — scanning the package directory
 * directly means DroidBridge's own `winget install Genymobile.scrcpy` hint
 * results in detection without requiring an app restart. Only runs when the
 * probe supports directory listing, so unit tests stay deterministic.
 */
export function findWingetScrcpy(localAppData: string | undefined, probe: FileProbe): string | null {
  if (!localAppData || !probe.listDir) return null;
  const packagesDir = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  let packages: string[];
  try {
    packages = probe.listDir(packagesDir);
  } catch {
    return null;
  }
  for (const pkg of packages) {
    if (!pkg.startsWith('Genymobile.scrcpy')) continue;
    const pkgPath = join(packagesDir, pkg);
    const flat = join(pkgPath, 'scrcpy.exe');
    if (probe.isFile(flat)) return flat;
    let nested: string[];
    try {
      nested = probe.listDir(pkgPath);
    } catch {
      continue;
    }
    for (const dir of nested) {
      const candidate = join(pkgPath, dir, 'scrcpy.exe');
      if (probe.isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Finds scrcpy: override → PATH → winget packages → Program Files locations. */
export function findScrcpy(env: NodeJS.ProcessEnv, probe: FileProbe): LocateResult {
  const override = env.DROIDBRIDGE_SCRCPY_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

  const fromPath = whichSync(windowsNames('scrcpy'), env.PATH, probe);
  if (fromPath) return { path: fromPath, source: 'path' };

  const localAppData = env.LOCALAPPDATA;
  const fromWinget = findWingetScrcpy(localAppData, probe);
  if (fromWinget) return { path: fromWinget, source: 'default-location' };

  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const fromDefault = firstExisting([
    localAppData ? join(localAppData, 'Programs', 'scrcpy', 'scrcpy.exe') : '',
    join(programFiles, 'scrcpy', 'scrcpy.exe'),
    'C:\\scrcpy\\scrcpy.exe',
  ], probe);
  if (fromDefault) return { path: fromDefault, source: 'default-location' };

  return { path: null, source: 'not-found' };
}

/** Finds the VS Code CLI: override → PATH → per-user/Program Files installs. */
export function findVSCode(env: NodeJS.ProcessEnv, probe: FileProbe): LocateResult {
  const override = env.DROIDBRIDGE_VSCODE_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

  const fromPath = whichSync(windowsNames('code'), env.PATH, probe);
  if (fromPath) return { path: fromPath, source: 'path' };

  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const fromDefault = firstExisting([
    localAppData ? join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : '',
    join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
  ], probe);
  if (fromDefault) return { path: fromDefault, source: 'default-location' };

  return { path: null, source: 'not-found' };
}

const finders: Record<ToolName, (env: NodeJS.ProcessEnv, probe: FileProbe) => LocateResult> = {
  adb: findAdb,
  flutter: findFlutter,
  scrcpy: findScrcpy,
  code: findVSCode,
};

export function findTool(tool: ToolName, env: NodeJS.ProcessEnv = process.env, probe?: FileProbe): LocateResult {
  return finders[tool](env, probe ?? defaultFileProbe);
}
