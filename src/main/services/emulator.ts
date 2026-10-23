import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { DroidBridgeError } from '../errors';
import { findEmulator, type LocateResult } from '../adb/locate';
import { runCommand, spawnManaged, type RunResult } from '../adb/run';
import { isValidAvdName } from '../../shared/validation';
import type { ProcessRegistry } from '../process/registry';

/** Reported when a started emulator process ends (or fails to spawn). */
export interface EmulatorExit {
  sessionId: string;
  avd: string;
  code: number | null;
  error?: string;
}

export interface EmulatorSink {
  onExit(exit: EmulatorExit): void;
}

/** Injection points so unit tests never touch the real filesystem or processes. */
export interface EmulatorDeps {
  locate?: () => LocateResult;
  run?: (bin: string, argv: readonly string[]) => Promise<RunResult>;
  spawn?: (bin: string, argv: readonly string[]) => ChildProcess;
}

const LIST_TIMEOUT_MS = 15_000;
const LIST_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_LISTED_AVDS = 200;
/** Bytes of child output kept for the exit report (last chunk — the failure is at the end). */
const EXIT_ERROR_MAX_CHARS = 4096;

const EMULATOR_NOT_FOUND_MESSAGE =
  'The Android emulator is not installed. Install the "Emulator" package from Android Studio\'s SDK Manager, or set DROIDBRIDGE_EMULATOR_PATH.';

/**
 * Parses `emulator -list-avds` stdout: one AVD name per line, CRLF endings,
 * blank lines, and stray tool noise (`INFO | emulator: ...`) filtered through
 * the shared AVD validator so every listed name can be passed straight back to
 * `emulator -avd <name>`. Duplicate names are dropped; the list is capped.
 */
export function parseAvdList(stdout: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const name = rawLine.trim();
    if (!isValidAvdName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_LISTED_AVDS) break;
  }
  return out;
}

/**
 * Builds the emulator argv for a virtual device. Pure and unit-tested; the
 * AVD name becomes exactly one argv entry (never shell-interpreted).
 */
export function buildEmulatorStartArgs(avd: string): string[] {
  return ['-avd', avd];
}

/** Lists AVDs and boots them, tracking every started emulator for clean shutdown. */
export class EmulatorManager {
  constructor(
    private readonly registry: ProcessRegistry,
    private readonly sink: EmulatorSink,
    private readonly deps: EmulatorDeps = {},
  ) {}

  /** AVD names installed on this machine (`emulator -list-avds`). */
  async list(): Promise<string[]> {
    const located = (this.deps.locate ?? (() => findEmulator()))();
    if (!located.path) {
      throw new DroidBridgeError('EMULATOR_NOT_FOUND', EMULATOR_NOT_FOUND_MESSAGE);
    }

    const run = this.deps.run ?? ((bin: string, argv: readonly string[]) => runCommand(bin, argv, {
      timeoutMs: LIST_TIMEOUT_MS,
      maxOutputBytes: LIST_MAX_OUTPUT_BYTES,
    }));
    const result = await run(located.path, ['-list-avds']);

    if (result.timedOut) {
      throw new DroidBridgeError(
        'EMULATOR_LIST_FAILED',
        'Listing Android virtual devices timed out — the emulator tool did not respond.',
      );
    }
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new DroidBridgeError(
        'EMULATOR_LIST_FAILED',
        detail || `emulator -list-avds failed with exit code ${String(result.code)}.`,
      );
    }
    return parseAvdList(result.stdout);
  }

  /**
   * Boots an AVD. Returns a session id; the outcome is delivered later via
   * `EmulatorSink.onExit` — the emulator prints failures like
   * `PANIC: unknown AVD name` and exits non-zero, which we capture.
   */
  async start(avd: string): Promise<string> {
    const located = (this.deps.locate ?? (() => findEmulator()))();
    if (!located.path) {
      throw new DroidBridgeError('EMULATOR_NOT_FOUND', EMULATOR_NOT_FOUND_MESSAGE);
    }

    const spawn = this.deps.spawn ?? spawnManaged;
    const child = spawn(located.path, buildEmulatorStartArgs(avd));
    const sessionId = randomUUID();
    this.registry.track(`emulator:${sessionId}`, 'emulator', child);

    // Keep a bounded tail of the emulator's output: it is the only honest
    // diagnostic when the boot fails, and draining the pipes keeps the child
    // from ever blocking on a full stdio buffer.
    let outTail = '';
    let errTail = '';
    const keepTail = (chunk: string, previous: string): string =>
      (previous + chunk).slice(-EXIT_ERROR_MAX_CHARS);
    child.stdout?.on('data', (chunk: Buffer) => {
      outTail = keepTail(chunk.toString('utf8'), outTail);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      errTail = keepTail(chunk.toString('utf8'), errTail);
    });

    let finished = false;
    const finish = (code: number | null, error?: string): void => {
      if (finished) return; // spawn 'error' can be followed by 'close' — report once
      finished = true;
      this.registry.remove(`emulator:${sessionId}`);
      this.sink.onExit({ sessionId, avd, code, ...(error !== undefined ? { error } : {}) });
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(null, error.code === 'ENOENT' ? `emulator not found: ${located.path}` : error.message);
    });

    child.on('close', (code) => {
      const failureOutput = (errTail || outTail).trim();
      finish(code, code !== 0 && failureOutput ? failureOutput : undefined);
    });

    return sessionId;
  }
}
