import { describe, expect, it } from 'vitest';
import { ProcessRegistry } from '../../src/main/process/registry';
import { buildLogcatArgs, MAX_CONCURRENT_LOGCAT_SESSIONS } from '../../src/main/adb/logcat';
import { buildScrcpyArgs } from '../../src/main/services/scrcpy';
import { spawn } from 'node:child_process';

describe('ProcessRegistry', () => {
  it('tracks, lists and stops processes', async () => {
    const registry = new ProcessRegistry();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    registry.track('p1', 'test', child);

    expect(registry.size()).toBe(1);
    expect(registry.list()[0]).toMatchObject({ id: 'p1', kind: 'test' });

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      expect(registry.stop('p1')).toBe(true);
    });

    expect(registry.size()).toBe(0);
    expect(registry.stop('p1')).toBe(false);
  });

  it('rejects duplicate ids and cleans up on stopAll', async () => {
    const registry = new ProcessRegistry();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    registry.track('dup', 'test', child);
    expect(() => registry.track('dup', 'test', child)).toThrow(/already tracked/);

    registry.stopAll();
    await new Promise((resolve) => child.once('exit', resolve));
    expect(registry.size()).toBe(0);
  });

  it('removes naturally exited processes without killing', () => {
    const registry = new ProcessRegistry();
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    registry.track('p2', 'test', child);
    expect(registry.remove('p2')).toBe(true);
    expect(registry.size()).toBe(0);
  });
});

describe('buildLogcatArgs', () => {
  it('uses threadtime with a recent tail and per-buffer flags', () => {
    expect(buildLogcatArgs({ buffers: ['main', 'crash'], filterSpecs: [] })).toEqual([
      '-v', 'threadtime', '-T', '1000', '-b', 'main', '-b', 'crash',
    ]);
  });

  it('omits -b for "all" and appends validated filter specs', () => {
    expect(buildLogcatArgs({ buffers: ['all'], filterSpecs: ['ActivityManager:I', '*:S'] })).toEqual([
      '-v', 'threadtime', '-T', '1000', 'ActivityManager:I', '*:S',
    ]);
  });

  it('exports the session cap for the UI', () => {
    expect(MAX_CONCURRENT_LOGCAT_SESSIONS).toBeGreaterThan(0);
  });
});

describe('buildScrcpyArgs', () => {
  it('maps options to individual argv entries', () => {
    const args = buildScrcpyArgs({
      serial: 'R58M12ABCD',
      maxFps: 30,
      bitrateMbps: 4,
      alwaysOnTop: true,
      fullscreen: false,
      noAudio: true,
      windowTitle: 'My Device',
    });
    expect(args).toEqual([
      '-s', 'R58M12ABCD',
      '--max-fps=30',
      '--video-bit-rate=4M',
      '--always-on-top',
      '--no-audio',
      '--window-title=My Device',
    ]);
  });

  it('includes no optional flags by default', () => {
    expect(buildScrcpyArgs({ serial: 'emulator-5554' })).toEqual(['-s', 'emulator-5554']);
  });
});
