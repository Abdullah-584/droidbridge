import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUpdater,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdaterLike,
} from '../../src/main/services/updater';
import type { UpdateStatus } from '../../src/shared/types';
import { ValidationError } from '../../src/shared/validation';

/** Drive-able stand-in for electron-updater's autoUpdater singleton. */
class FakeUpdater implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => ({}));
  quitAndInstall = vi.fn();
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe('createUpdater', () => {
  let fake: FakeUpdater;
  let statuses: UpdateStatus[];
  const emit = (status: UpdateStatus): void => {
    statuses.push(status);
  };

  beforeEach(() => {
    fake = new FakeUpdater();
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables auto-download and install-on-quit', () => {
    createUpdater(fake, { isPackaged: true, emit });
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(true);
  });

  it('stays completely silent in development (not packaged)', () => {
    vi.useFakeTimers();
    const updater = createUpdater(fake, { isPackaged: false, emit });
    updater.start();
    fake.fire('checking-for-update');
    fake.fire('update-downloaded', { version: '9.9.9' });
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    // Installing outside a packaged build must not pretend to work either.
    expect(() => updater.install()).toThrow(ValidationError);
  });

  it('checks once at start, re-checks on the interval, and stops cleanly', async () => {
    vi.useFakeTimers();
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);

    updater.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('maps electron-updater events to renderer statuses', () => {
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    fake.fire('checking-for-update');
    fake.fire('update-available', { version: '1.2.0' });
    fake.fire('download-progress', { percent: 41.6 });
    fake.fire('update-downloaded', { version: '1.2.0' });
    fake.fire('error', new Error('offline'));
    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'available', version: '1.2.0' },
      { state: 'downloading', percent: 42 },
      { state: 'downloaded', version: '1.2.0' },
      { state: 'error', message: 'offline' },
    ]);
  });

  it('reports when no update is available', () => {
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    fake.fire('update-not-available');
    expect(statuses).toContainEqual({ state: 'not-available' });
  });

  it('refuses to install before an update has been downloaded', () => {
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    expect(() => updater.install()).toThrow(ValidationError);
    expect(fake.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs once the update is downloaded — silently, then relaunches', () => {
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    fake.fire('update-downloaded', { version: '1.2.0' });
    updater.install();
    // isSilent: no setup wizard; isForceRunAfter: app reopens on the new version.
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(fake.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('surfaces a failed check as an error status instead of crashing', async () => {
    fake.checkForUpdates.mockRejectedValueOnce(new Error('network down'));
    const updater = createUpdater(fake, { isPackaged: true, emit });
    updater.start();
    await vi.waitFor(() =>
      expect(statuses).toContainEqual({ state: 'error', message: 'network down' }),
    );
  });
});
