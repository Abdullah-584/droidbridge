import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { DroidBridgeError } from '../errors';

export interface RunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  killed: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const KILL_GRACE_MS = 2_000;
const BATCH_FILE_RE = /\.(bat|cmd)$/i;

/** True when the executable is a Windows batch file that needs cmd.exe. */
export function isBatchFile(bin: string): boolean {
  return process.platform === 'win32' && BATCH_FILE_RE.test(bin);
}

const CMD_METACHAR_RE = /["%&|<>^()!\r\n]/;

/**
 * Batch files (.bat/.cmd) cannot be spawned directly on modern Node and are
 * interpreted by cmd.exe. Because batch scripts re-parse their arguments
 * (e.g. `%1` expansion), cmd metacharacters are rejected outright — validated
 * user input can therefore never act as shell syntax. Spaces are fine: every
 * token is quoted.
 */
export function assertBatchSafeArg(arg: string): void {
  if (CMD_METACHAR_RE.test(arg)) {
    throw new DroidBridgeError(
      'UNSAFE_ARGUMENT',
      'This value contains characters that are not supported for command-line tools (.bat/.cmd): " % & | < > ^ ( ) !',
    );
  }
}

/** Builds the wrapped `/d /s /c` command line used to launch batch files. */
export function buildBatchCommandLine(bin: string, argv: readonly string[]): string {
  assertBatchSafeArg(bin);
  for (const arg of argv) assertBatchSafeArg(arg);
  const inner = [bin, ...argv].map((token) => `"${token}"`).join(' ');
  return `"${inner}"`;
}

/** Resolves the real executable + argv (batch files go through cmd.exe). */
export function resolveExecutable(bin: string, argv: readonly string[]): { bin: string; argv: string[] } {
  if (!isBatchFile(bin)) return { bin, argv: [...argv] };
  const cmd = process.env.ComSpec ?? 'cmd.exe';
  return { bin: cmd, argv: ['/d', '/s', '/c', buildBatchCommandLine(bin, argv)] };
}

/** Rejects values that could never be a legitimate executable or argument. */
function assertSafeArgv(bin: string, argv: readonly string[]): void {
  if (typeof bin !== 'string' || bin.length === 0 || bin.includes('\u0000')) {
    throw new DroidBridgeError('INVALID_COMMAND', 'Executable path is invalid.');
  }
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.includes('\u0000')) {
      throw new DroidBridgeError('INVALID_COMMAND', 'Command arguments must be plain strings.');
    }
  }
}

/**
 * Runs an external command with `spawn(bin, argv, { shell: false })`.
 * A shell is never used, so no value can ever be interpreted as shell syntax.
 */
export async function runCommand(bin: string, argv: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  assertSafeArgv(bin, argv);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<RunResult>((resolve, reject) => {
    const started = Date.now();
    const spawnOpts: SpawnOptions = {
      windowsHide: true,
      shell: false,
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    };

    let child: ChildProcess;
    try {
      const resolved = resolveExecutable(bin, argv);
      // cmd.exe needs the command line verbatim: Node's backslash-escaping of
      // quotes is a CreateProcess convention that cmd does not understand.
      const throughCmd = resolved.bin !== bin;
      child = spawn(resolved.bin, resolved.argv, {
        ...spawnOpts,
        windowsVerbatimArguments: throughCmd,
      });
    } catch (e) {
      reject(e);
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let killed = false;

    const append = (chunks: Buffer[], chunk: Buffer, count: (n: number) => void): void => {
      count(chunk.length);
      if (outBytes + errBytes <= maxBytes) {
        chunks.push(chunk);
      } else if (!truncated) {
        truncated = true;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => append(outChunks, chunk, (n) => (outBytes += n)));
    child.stderr?.on('data', (chunk: Buffer) => append(errChunks, chunk, (n) => (errBytes += n)));

    if (opts.input !== undefined) {
      child.stdin?.on('error', () => {
        /* EPIPE when the child exits early — not fatal for us */
      });
      child.stdin?.end(opts.input);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      const escalate = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }, KILL_GRACE_MS);
      escalate.unref();
    }, timeoutMs);
    timer.unref();

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(
          new DroidBridgeError('TOOL_NOT_FOUND', `Executable not found: ${bin}`, { bin }),
        );
      } else {
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal: signal as NodeJS.Signals | null,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        timedOut,
        truncated,
        killed,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Spawns a long-lived process (no capture). Caller manages stdout/stderr. */
export function spawnManaged(bin: string, argv: readonly string[], opts: RunOptions = {}): ChildProcess {
  assertSafeArgv(bin, argv);
  const resolved = resolveExecutable(bin, argv);
  const throughCmd = resolved.bin !== bin;
  return spawn(resolved.bin, resolved.argv, {
    windowsHide: false,
    shell: false,
    windowsVerbatimArguments: throughCmd,
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
