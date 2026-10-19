import path from 'node:path';
import { getAdbToolInfo } from '../adb/adb';
import { findTool } from '../adb/locate';
import { runCommand } from '../adb/run';
import { DroidBridgeError } from '../errors';
import { parseFlutterDevices } from '../adb/parse';
import { probeScrcpy } from './scrcpy';
import type { CommandResult, FlutterDevicesResult, SystemStatus, ToolInfo } from '../../shared/types';

const FLUTTER_VERSION_TIMEOUT_MS = 60_000;

async function toCommandResult(
  bin: string,
  argv: readonly string[],
  opts: { timeoutMs: number; cwd?: string },
): Promise<CommandResult> {
  const result = await runCommand(bin, argv, {
    timeoutMs: opts.timeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    cwd: opts.cwd,
  });
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    truncated: result.truncated,
    durationMs: result.durationMs,
  };
}

async function probeGeneric(
  tool: ToolInfo['tool'],
  hint: string | undefined,
  versionArgs: readonly string[],
  timeoutMs: number,
): Promise<ToolInfo> {
  const located = findTool(tool);
  if (!located.path) {
    return { tool, available: false, path: null, version: null, source: 'not-found', hint };
  }
  let version: string | null = null;
  try {
    const result = await runCommand(located.path, versionArgs, { timeoutMs, maxOutputBytes: 256 * 1024 });
    const text = `${result.stdout}${result.stderr}`;
    version =
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? null;
  } catch {
    version = null;
  }
  return { tool, available: true, path: located.path, version, source: located.source };
}

/** Probes one tool (adb/flutter/scrcpy/code) including its version banner. */
export async function getToolInfo(tool: ToolInfo['tool']): Promise<ToolInfo> {
  switch (tool) {
    case 'adb':
      return getAdbToolInfo();
    case 'flutter':
      return probeGeneric(
        'flutter',
        'Install the Flutter SDK and add its bin directory to PATH (https://docs.flutter.dev/get-started/install).',
        ['--version'],
        FLUTTER_VERSION_TIMEOUT_MS,
      );
    case 'scrcpy':
      {
        const probe = await probeScrcpy();
        return {
          tool: 'scrcpy',
          available: probe.path !== null,
          path: probe.path,
          version: probe.version,
          source: probe.path ? (findTool('scrcpy').source as ToolInfo['source']) : 'not-found',
          hint:
            probe.path === null
              ? 'Install scrcpy with: winget install Genymobile.scrcpy'
              : undefined,
        };
      }
    case 'code':
      return probeGeneric(
        'code',
        'Install Visual Studio Code and enable "Code CLI" (add code.cmd to PATH).',
        ['--version'],
        15_000,
      );
  }
}

/** Aggregates tool status plus app metadata for the dashboard. */
export async function buildSystemStatus(appVersion: string, platform: string): Promise<SystemStatus> {
  const [adb, flutter, scrcpy, vscode] = await Promise.all([
    getToolInfo('adb'),
    getToolInfo('flutter'),
    getToolInfo('scrcpy'),
    getToolInfo('code'),
  ]);
  return { appVersion, platform, adb, flutter, scrcpy, vscode };
}

/** Runs `flutter doctor -v` (can take a while; output is returned in full). */
export async function runFlutterDoctor(): Promise<CommandResult> {
  const located = findTool('flutter');
  if (!located.path) {
    throw new DroidBridgeError('FLUTTER_NOT_FOUND', 'Flutter SDK was not found on this machine.');
  }
  return toCommandResult(located.path, ['doctor', '-v'], { timeoutMs: 180_000 });
}

/** Runs `flutter devices` and parses the device table. */
export async function runFlutterDevices(): Promise<FlutterDevicesResult> {
  const located = findTool('flutter');
  if (!located.path) {
    throw new DroidBridgeError('FLUTTER_NOT_FOUND', 'Flutter SDK was not found on this machine.');
  }
  const result = await toCommandResult(located.path, ['devices'], { timeoutMs: 90_000 });
  const raw = `${result.stdout}${result.stderr}`;
  return { raw, devices: parseFlutterDevices(raw) };
}

/** Runs `flutter pub get` inside a user-picked project directory. */
export async function runFlutterPubGet(projectPath: string): Promise<CommandResult> {
  const located = findTool('flutter');
  if (!located.path) {
    throw new DroidBridgeError('FLUTTER_NOT_FOUND', 'Flutter SDK was not found on this machine.');
  }
  const pubspec = path.join(projectPath, 'pubspec.yaml');
  try {
    const fs = await import('node:fs');
    if (!fs.statSync(pubspec).isFile()) {
      throw new DroidBridgeError('NOT_A_FLUTTER_PROJECT', `No pubspec.yaml found in ${projectPath}.`);
    }
  } catch (e) {
    if (e instanceof DroidBridgeError) throw e;
    throw new DroidBridgeError('NOT_A_FLUTTER_PROJECT', `No pubspec.yaml found in ${projectPath}.`);
  }
  return toCommandResult(located.path, ['pub', 'get'], { timeoutMs: 240_000, cwd: projectPath });
}

/** Opens a folder in VS Code via its CLI (never writes to the project). */
export async function openFolderInVSCode(folderPath: string): Promise<void> {
  const located = findTool('code');
  if (!located.path) {
    throw new DroidBridgeError('VSCODE_NOT_FOUND', 'Visual Studio Code CLI was not found on this machine.');
  }
  const result = await runCommand(located.path, [folderPath], { timeoutMs: 20_000, maxOutputBytes: 64 * 1024 });
  if (result.code !== 0 && result.code !== null) {
    throw new DroidBridgeError(
      'VSCODE_LAUNCH_FAILED',
      `VS Code exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}
