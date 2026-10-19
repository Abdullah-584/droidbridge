import type { ChildProcess } from 'node:child_process';

export interface TrackedProcess {
  id: string;
  kind: string;
  pid: number | undefined;
  startedAt: number;
}

/**
 * Tracks every long-lived child process the app spawns (logcat streams,
 * scrcpy windows) so they can be stopped individually or all at once when the
 * app quits. Kills with SIGTERM and escalates to SIGKILL after a grace period.
 */
export class ProcessRegistry {
  private readonly procs = new Map<string, { kind: string; child: ChildProcess; startedAt: number }>();

  track(id: string, kind: string, child: ChildProcess): void {
    const existing = this.procs.get(id);
    if (existing) {
      throw new Error(`Process id already tracked: ${id}`);
    }
    this.procs.set(id, { kind, child, startedAt: Date.now() });
  }

  has(id: string): boolean {
    return this.procs.has(id);
  }

  size(): number {
    return this.procs.size;
  }

  list(): TrackedProcess[] {
    const out: TrackedProcess[] = [];
    for (const [id, entry] of this.procs) {
      out.push({ id, kind: entry.kind, pid: entry.child.pid, startedAt: entry.startedAt });
    }
    return out;
  }

  /** Stops a tracked process. Returns true if a process was stopped. */
  stop(id: string, graceMs = 1500): boolean {
    const entry = this.procs.get(id);
    if (!entry) return false;
    this.procs.delete(id);
    killTree(entry.child, graceMs);
    return true;
  }

  /** Removes a naturally exited process from the registry (no kill). */
  remove(id: string): boolean {
    return this.procs.delete(id);
  }

  stopAll(graceMs = 1500): void {
    for (const [id, entry] of this.procs) {
      this.procs.delete(id);
      killTree(entry.child, graceMs);
    }
  }
}

function killTree(child: ChildProcess, graceMs: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, graceMs);
  timer.unref();
  child.once('exit', () => clearTimeout(timer));
}

/** Shared registry instance used by the whole main process. */
export const processRegistry = new ProcessRegistry();
