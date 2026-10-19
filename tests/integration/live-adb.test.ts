import { describe, expect, it } from 'vitest';
import { findTool } from '../../src/main/adb/locate';
import { runCommand } from '../../src/main/adb/run';
import { parseAdbDevicesOutput } from '../../src/main/adb/parse';
import { listDevices } from '../../src/main/services/devices';
import { buildSystemStatus } from '../../src/main/services/tools';
import { probeScrcpy } from '../../src/main/services/scrcpy';

/**
 * Live smoke tests: these run the real adb/flutter binaries installed on the
 * machine (no device is required). They assert the honest, real-data path.
 */
describe('live adb', () => {
  it('runs the real `adb version` through the safe runner', async () => {
    const located = findTool('adb');
    expect(located.path, 'adb must be installed for live tests').toBeTruthy();

    const result = await runCommand(located.path!, ['version'], { timeoutMs: 15_000 });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Android Debug Bridge version');
  });

  it('lists real devices (or reports honestly when none are attached)', async () => {
    const result = await listDevices();
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.devices)).toBe(true);
    expect(result.raw).toContain('List of devices attached');

    for (const device of result.devices) {
      expect(device.serial.length).toBeGreaterThan(0);
      expect(['device', 'offline', 'unauthorized', 'authorizing', 'no-permissions', 'recovery', 'sideload', 'rescue', 'unknown']).toContain(
        device.state,
      );
    }

    // Parsers agree with the service on the same raw output.
    expect(parseAdbDevicesOutput(result.raw).length).toBe(result.devices.length);
  });

  it('reports tool availability without fabricating data', async () => {
    const status = await buildSystemStatus('1.0.0', process.platform);
    expect(status.adb.available).toBe(true);
    if (!status.flutter.available) {
      expect(status.flutter.path).toBeNull();
      expect(status.flutter.hint).toBeTruthy();
    }
  });
});

describe.runIf(findTool('flutter').path !== null)('live flutter', () => {
  it('runs the real `flutter --version`', async () => {
    const located = findTool('flutter');
    const result = await runCommand(located.path!, ['--version'], { timeoutMs: 120_000, maxOutputBytes: 256 * 1024 });
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('flutter');
  }, 130_000);
});

describe('live scrcpy', () => {
  it('resolves an installed scrcpy (including winget) and reports honestly', async () => {
    const located = findTool('scrcpy');
    if (!located.path) {
      // Not installed on this machine → the honest negative is the contract.
      expect(located.source).toBe('not-found');
      const missing = await probeScrcpy();
      expect(missing.path).toBeNull();
      expect(missing.version).toBeNull();
      return;
    }
    const probe = await probeScrcpy();
    expect(probe.path).toBe(located.path);
    expect(probe.version ?? '').toMatch(/scrcpy/i);
  }, 30_000);
});
