import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LogcatManager } from '../../src/main/adb/logcat';
import { ProcessRegistry } from '../../src/main/process/registry';
import type { LogcatLine } from '../../src/shared/types';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droidbridge-logcat-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, body: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

interface Captured {
  batches: LogcatLine[][];
  exits: { sessionId: string; code: number | null; error?: string }[];
}

function makeManager(binPath: string): { manager: LogcatManager; registry: ProcessRegistry; captured: Captured } {
  const registry = new ProcessRegistry();
  const captured: Captured = { batches: [], exits: [] };
  const manager = new LogcatManager(
    registry,
    {
      onLines(_sessionId, lines) {
        captured.batches.push(lines);
      },
      onExit(sessionId, code, error) {
        captured.exits.push({ sessionId, code, error });
      },
    },
    async () => binPath,
  );
  return { manager, registry, captured };
}

const canRunFixtures = process.platform === 'win32';

describe.runIf(canRunFixtures)('LogcatManager', () => {
  it('streams parsed lines from the fixture and reports exit', async () => {
    const fixture = writeFixture(
      'logcat-fixture.cmd',
      [
        '@echo off',
        'echo 10-18 22:57:33.123  1234  5678 I TestTag: hello from fixture',
        'echo 10-18 22:57:33.124  1234  5678 W Slow: warn line',
        'exit /b 0',
      ].join('\r\n'),
    );
    const { manager, captured } = makeManager(fixture);

    const sessionId = await manager.start({
      serial: 'emulator-5554',
      buffers: ['main'],
      level: 'verbose',
      filterSpecs: [],
    });

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (captured.exits.length > 0) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });

    const lines = captured.batches.flat();
    expect(lines).toHaveLength(2);
    expect(lines[0].tag).toBe('TestTag');
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toBe('hello from fixture');
    expect(lines[0].seq).toBe(1);
    expect(lines[1].level).toBe('warn');
    expect(captured.exits[0]).toMatchObject({ sessionId, code: 0 });
    expect(manager.sessions_()).toHaveLength(0);
  });

  it('stops a long-running session and cleans the registry', async () => {
    const fixture = writeFixture(
      'logcat-long.cmd',
      ['@echo off', 'ping -n 60 127.0.0.1 >nul', 'echo done'].join('\r\n'),
    );
    const { manager, registry } = makeManager(fixture);
    const sessionId = await manager.start({
      serial: 'emulator-5554',
      buffers: ['main'],
      level: 'verbose',
      filterSpecs: [],
    });

    expect(registry.has(`logcat:${sessionId}`)).toBe(true);
    expect(manager.sessions_()).toEqual([{ sessionId, serial: 'emulator-5554', running: true }]);

    manager.stop(sessionId);
    await new Promise((r) => setTimeout(r, 300));
    expect(registry.has(`logcat:${sessionId}`)).toBe(false);
    expect(manager.sessions_()).toHaveLength(0);
  });
});
