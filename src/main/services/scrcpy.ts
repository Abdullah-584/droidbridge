import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { ScrcpyOptions } from '../../shared/types';
import { DroidBridgeError } from '../errors';
import { findTool } from '../adb/locate';
import { runCommand, spawnManaged } from '../adb/run';
import type { ProcessRegistry } from '../process/registry';

export interface ScrcpySink {
  onExit(sessionId: string, code: number | null, error?: string): void;
}

/**
 * Builds the scrcpy argv from validated options. Pure and unit-tested; every
 * value becomes exactly one argv entry (no shell involved).
 */
export function buildScrcpyArgs(options: ScrcpyOptions): string[] {
  const args: string[] = ['-s', options.serial];
  if (options.maxFps !== undefined) args.push(`--max-fps=${options.maxFps}`);
  if (options.bitrateMbps !== undefined) args.push(`--video-bit-rate=${options.bitrateMbps}M`);
  if (options.alwaysOnTop) args.push('--always-on-top');
  if (options.fullscreen) args.push('--fullscreen');
  if (options.noAudio) args.push('--no-audio');
  if (options.windowTitle) args.push(`--window-title=${options.windowTitle}`);
  return args;
}

/** Spawns scrcpy mirroring windows and tracks them for clean shutdown. */
export class ScrcpyManager {
  private readonly sessions = new Map<string, { serial: string; child: ChildProcess }>();

  constructor(
    private readonly registry: ProcessRegistry,
    private readonly sink: ScrcpySink,
  ) {}

  async start(options: ScrcpyOptions): Promise<string> {
    const located = findTool('scrcpy');
    if (!located.path) {
      throw new DroidBridgeError(
        'SCRCPY_NOT_FOUND',
        'scrcpy is not installed. Install it with "winget install Genymobile.scrcpy" and try again.',
      );
    }

    const child = spawnManaged(located.path, buildScrcpyArgs(options));
    const id = randomUUID();
    this.sessions.set(id, { serial: options.serial, child });
    this.registry.track(`scrcpy:${id}`, 'scrcpy', child);

    child.on('error', (error: NodeJS.ErrnoException) => {
      this.sessions.delete(id);
      this.registry.remove(`scrcpy:${id}`);
      this.sink.onExit(id, null, error.code === 'ENOENT' ? `scrcpy not found: ${located.path}` : error.message);
    });

    child.on('close', (code) => {
      if (!this.sessions.has(id)) return;
      this.sessions.delete(id);
      this.registry.remove(`scrcpy:${id}`);
      this.sink.onExit(id, code);
    });

    return id;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.registry.stop(`scrcpy:${sessionId}`);
    this.sink.onExit(sessionId, null);
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) this.stop(id);
  }
}

/** Resolves scrcpy availability + version (one-shot probe). */
export async function probeScrcpy(): Promise<{ path: string | null; version: string | null }> {
  const located = findTool('scrcpy');
  if (!located.path) return { path: null, version: null };
  try {
    const result = await runCommand(located.path, ['--version'], { timeoutMs: 8_000, maxOutputBytes: 32 * 1024 });
    const first = (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim() ?? null;
    return { path: located.path, version: first };
  } catch {
    return { path: located.path, version: null };
  }
}
