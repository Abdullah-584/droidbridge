import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { LogcatLine, LogcatOptions, LogcatSessionInfo } from '../../shared/types';
import { parseLogcatLine } from './parse';
import { spawnManaged } from './run';
import { DroidBridgeError } from '../errors';
import type { ProcessRegistry } from '../process/registry';

export interface LogcatSink {
  onLines(sessionId: string, lines: LogcatLine[]): void;
  onExit(sessionId: string, code: number | null, error?: string): void;
}

export const MAX_CONCURRENT_LOGCAT_SESSIONS = 4;
const BATCH_MAX_LINES = 200;
const BATCH_MAX_MS = 250;
const MAX_UNCLOSED_BUFFER = 64 * 1024;

/** Builds the argv for a logcat session (pure; covered by unit tests). */
export function buildLogcatArgs(options: Pick<LogcatOptions, 'buffers' | 'filterSpecs'>): string[] {
  const args: string[] = ['-v', 'threadtime', '-T', '1000'];
  const buffers = options.buffers.length === 0 ? ['main'] : options.buffers;
  if (!buffers.includes('all')) {
    for (const buffer of buffers) {
      args.push('-b', buffer);
    }
  }
  for (const spec of options.filterSpecs) {
    args.push(spec);
  }
  return args;
}

interface Session {
  id: string;
  serial: string;
  child: ChildProcess;
  running: boolean;
}

/**
 * Manages live `adb logcat` streaming sessions. Output is line-buffered and
 * batched before being pushed to the renderer to keep IPC traffic bounded.
 */
export class LogcatManager {
  private readonly sessions = new Map<string, Session>();
  private seqBySession = new Map<string, number>();

  constructor(
    private readonly registry: ProcessRegistry,
    private readonly sink: LogcatSink,
    private readonly resolveBin: () => Promise<string>,
  ) {}

  async start(options: LogcatOptions): Promise<string> {
    const active = [...this.sessions.values()].filter((s) => s.running).length;
    if (active >= MAX_CONCURRENT_LOGCAT_SESSIONS) {
      throw new DroidBridgeError(
        'SESSION_LIMIT',
        `Logcat session limit reached (${MAX_CONCURRENT_LOGCAT_SESSIONS}). Stop a session first.`,
      );
    }

    const bin = await this.resolveBin();
    const id = randomUUID();
    const args = ['-s', options.serial, 'logcat', ...buildLogcatArgs(options)];
    const child = spawnManaged(bin, args);

    const session: Session = { id, serial: options.serial, child, running: true };
    this.sessions.set(id, session);
    this.registry.track(`logcat:${id}`, 'logcat', child);
    this.seqBySession.set(id, 0);

    let pending: LogcatLine[] = [];
    let partial = '';
    let flushTimer: NodeJS.Timeout | null = null;

    const flush = (): void => {
      flushTimer = null;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      if (this.sessions.has(id)) this.sink.onLines(id, batch);
    };
    const scheduleFlush = (): void => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, BATCH_MAX_MS);
      flushTimer.unref();
    };

    const handleChunk = (chunk: Buffer): void => {
      if (!session.running) return;
      partial += chunk.toString('utf8');
      let idx: number;
      while ((idx = partial.search(/\r?\n/)) !== -1) {
        const lineEnd = idx;
        const nlLen = partial[lineEnd] === '\r' && partial[lineEnd + 1] === '\n' ? 2 : 1;
        const raw = partial.slice(0, lineEnd);
        partial = partial.slice(lineEnd + nlLen);
        const parsed = parseLogcatLine(raw);
        const seq = (this.seqBySession.get(id) ?? 0) + 1;
        this.seqBySession.set(id, seq);
        pending.push({ seq, raw, ...parsed });
        if (pending.length >= BATCH_MAX_LINES) flush();
      }
      if (partial.length > MAX_UNCLOSED_BUFFER) {
        const seq = (this.seqBySession.get(id) ?? 0) + 1;
        this.seqBySession.set(id, seq);
        pending.push({ seq, raw: partial.slice(0, 4096), time: null, pid: null, tid: null, level: null, tag: null, message: null });
        partial = '';
        flush();
      }
      scheduleFlush();
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', (chunk: Buffer) => handleChunk(chunk));

    child.on('error', (error: NodeJS.ErrnoException) => {
      session.running = false;
      this.finish(id, null, error.code === 'ENOENT' ? `adb executable not found: ${bin}` : error.message);
    });

    child.on('close', (code) => {
      if (!session.running) return;
      session.running = false;
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      this.finish(id, code);
    });

    return id;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.running = false;
    this.registry.stop(`logcat:${sessionId}`);
    this.finish(sessionId, null, undefined, true);
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.running = false;
    }
    this.registry.stopAll();
  }

  sessions_(): LogcatSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.id,
      serial: s.serial,
      running: s.running,
    }));
  }

  private finish(id: string, code: number | null, error?: string, silentExit = false): void {
    this.sessions.delete(id);
    this.seqBySession.delete(id);
    this.registry.remove(`logcat:${id}`);
    if (!silentExit) this.sink.onExit(id, code, error);
  }
}
