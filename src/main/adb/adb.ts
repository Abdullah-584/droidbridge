import { DroidBridgeError } from '../errors';
import { findTool } from './locate';
import { runCommand, type RunOptions, type RunResult } from './run';
import type { ToolInfo } from '../../shared/types';

const ADB_CACHE_TTL_MS = 10_000;

let adbCache: { path: string | null; at: number } | null = null;

/** Clears the cached adb path (used after SDK env changes / server restarts). */
export function invalidateAdbCache(): void {
  adbCache = null;
}

/** Resolves the adb executable path, caching the lookup briefly. */
export async function resolveAdbPath(): Promise<string> {
  const now = Date.now();
  if (adbCache && now - adbCache.at < ADB_CACHE_TTL_MS && adbCache.path) {
    return adbCache.path;
  }
  const located = findTool('adb');
  adbCache = { path: located.path, at: now };
  if (!located.path) {
    throw new DroidBridgeError(
      'ADB_NOT_FOUND',
      'ADB was not found. Install Android SDK platform-tools and ensure adb is on your PATH, or set ANDROID_HOME.',
    );
  }
  return located.path;
}

/** Builds a full adb argv with `-s <serial>` prepended when a serial is given. */
export function buildAdbArgs(serial: string | undefined, args: readonly string[]): string[] {
  return serial ? ['-s', serial, ...args] : [...args];
}

/** Runs adb with a validated argv. Never uses a shell. */
export async function runAdb(
  args: readonly string[],
  opts: RunOptions & { serial?: string } = {},
): Promise<RunResult> {
  const bin = await resolveAdbPath();
  const { serial, ...runOpts } = opts;
  return runCommand(bin, buildAdbArgs(serial, args), runOpts);
}

/** ToolInfo for adb including a live version probe. */
export async function getAdbToolInfo(): Promise<ToolInfo> {
  const located = findTool('adb');
  if (!located.path) {
    return {
      tool: 'adb',
      available: false,
      path: null,
      version: null,
      source: 'not-found',
      hint: 'Install Android SDK platform-tools, or set ANDROID_HOME / DROIDBRIDGE_ADB_PATH.',
    };
  }
  let version: string | null = null;
  try {
    const result = await runCommand(located.path, ['version'], { timeoutMs: 8_000, maxOutputBytes: 64 * 1024 });
    version = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? null;
  } catch {
    version = null;
  }
  invalidateAdbCacheIf(located.path);
  return { tool: 'adb', available: true, path: located.path, version, source: located.source };
}

function invalidateAdbCacheIf(path: string): void {
  if (!adbCache || adbCache.path !== path) invalidateAdbCache();
}
