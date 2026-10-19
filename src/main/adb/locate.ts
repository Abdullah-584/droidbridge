import fs from 'node:fs';
import path from 'node:path';
import type { ToolName, ToolSource } from '../../shared/types';

export interface LocateResult {
  path: string | null;
  source: ToolSource;
}

export interface FileProbe {
  isFile(absolutePath: string): boolean;
  /** Optional directory listing (names only) — used to scan winget packages. */
  listDir?(dirPath: string): string[];
}

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

/** Finds the ADB executable: override → SDK env vars → PATH → default SDK dir. */
export function findAdb(env: NodeJS.ProcessEnv, probe: FileProbe): LocateResult {
  const override = env.DROIDBRIDGE_ADB_PATH;
  if (override && probe.isFile(override)) return { path: override, source: 'env' };

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
  const defaultProbe: FileProbe = {
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
  return finders[tool](env, probe ?? defaultProbe);
}
