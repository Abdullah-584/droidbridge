import type { UpdateStatus } from '../../shared/types';
import { ValidationError } from '../../shared/validation';

/** How often a packaged app re-checks GitHub for a newer release. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Structural subset of electron-updater's `autoUpdater`. Injected so the
 * update policy — and its tests — never depend on Electron at import time.
 */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface UpdaterHandle {
  /** Starts the initial check plus the interval (packaged builds only). Idempotent. */
  start(): void;
  /** Stops scheduled checks; call on app quit. */
  stop(): void;
  /** Quits into the installer for a fully downloaded update; throws otherwise. */
  install(): void;
}

export interface UpdaterOptions {
  /** Only installed builds talk to the update feed; dev runs stay silent. */
  isPackaged: boolean;
  /** Receives every status transition (wired to the `update:status` event). */
  emit: (status: UpdateStatus) => void;
  intervalMs?: number;
}

function infoVersion(info: unknown): string {
  if (typeof info === 'object' && info !== null) {
    const version = (info as { version?: unknown }).version;
    if (typeof version === 'string') return version;
  }
  return 'unknown';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wires an electron-updater instance to the app's update policy:
 * auto-download, auto-install on quit, periodic checks, and a status stream.
 */
export function createUpdater(updater: UpdaterLike, options: UpdaterOptions): UpdaterHandle {
  const { isPackaged, emit, intervalMs = UPDATE_CHECK_INTERVAL_MS } = options;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  let downloadedVersion: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  const check = (): void => {
    void updater.checkForUpdates().catch((e: unknown) => {
      emit({ state: 'error', message: errorMessage(e) });
    });
  };

  const wire = (): void => {
    updater.on('checking-for-update', () => emit({ state: 'checking' }));
    updater.on('update-available', (info: unknown) =>
      emit({ state: 'available', version: infoVersion(info) }),
    );
    updater.on('update-not-available', () => emit({ state: 'not-available' }));
    updater.on('download-progress', (progress: unknown) => {
      const raw =
        typeof progress === 'object' && progress !== null
          ? (progress as { percent?: unknown }).percent
          : undefined;
      emit({ state: 'downloading', percent: typeof raw === 'number' ? Math.round(raw) : 0 });
    });
    updater.on('update-downloaded', (info: unknown) => {
      downloadedVersion = infoVersion(info);
      emit({ state: 'downloaded', version: downloadedVersion });
    });
    updater.on('error', (err: unknown) => emit({ state: 'error', message: errorMessage(err) }));
  };

  return {
    start() {
      if (started || !isPackaged) return;
      started = true;
      wire();
      check();
      timer = setInterval(check, intervalMs);
      // Update checks must never keep the process alive.
      (timer as { unref?: () => void }).unref?.();
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    install() {
      if (!isPackaged || downloadedVersion === null) {
        throw new ValidationError('No update has been downloaded yet.');
      }
      updater.quitAndInstall();
    },
  };
}
