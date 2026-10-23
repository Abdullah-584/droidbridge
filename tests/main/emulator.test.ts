import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  EmulatorManager,
  buildEmulatorStartArgs,
  parseAvdList,
  type EmulatorExit,
  type EmulatorSink,
} from '../../src/main/services/emulator';
import { DroidBridgeError } from '../../src/main/errors';
import { ProcessRegistry } from '../../src/main/process/registry';
import type { LocateResult } from '../../src/main/adb/locate';
import type { RunResult } from '../../src/main/adb/run';

function runResult(partial: Partial<RunResult>): RunResult {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    truncated: false,
    killed: false,
    durationMs: 1,
    ...partial,
  };
}

/** Fake ChildProcess: an EventEmitter with stdout/stderr event emitters attached. */
function fakeChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  return child;
}

function emitData(stream: unknown, text: string): void {
  (stream as EventEmitter).emit('data', Buffer.from(text, 'utf8'));
}

const FOUND: LocateResult = { path: 'C:/sdk/emulator/emulator.exe', source: 'env' };
const MISSING: LocateResult = { path: null, source: 'not-found' };

interface Harness {
  manager: EmulatorManager;
  registry: ProcessRegistry;
  exits: EmulatorExit[];
  spawned: { bin: string; argv: readonly string[] }[];
  runs: { bin: string; argv: readonly string[] }[];
  child: ChildProcess;
}

function makeManager(overrides: {
  locate?: () => LocateResult;
  run?: (bin: string, argv: readonly string[]) => Promise<RunResult>;
  spawn?: (bin: string, argv: readonly string[]) => ChildProcess;
} = {}): Harness {
  const registry = new ProcessRegistry();
  const exits: EmulatorExit[] = [];
  const sink: EmulatorSink = { onExit: (exit) => exits.push(exit) };
  const spawned: { bin: string; argv: readonly string[] }[] = [];
  const runs: { bin: string; argv: readonly string[] }[] = [];
  const child = fakeChild();

  const manager = new EmulatorManager(registry, sink, {
    locate: overrides.locate ?? (() => FOUND),
    run:
      overrides.run ??
      (async (bin, argv) => {
        runs.push({ bin, argv });
        return runResult({ stdout: 'Pixel_7_API_34\r\npixel_5_api_33\r\n' });
      }),
    spawn:
      overrides.spawn ??
      ((bin, argv) => {
        spawned.push({ bin, argv });
        return child;
      }),
  });

  return { manager, registry, exits, spawned, runs, child };
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e) => e as DroidBridgeError,
  );
  expect(err).toBeInstanceOf(DroidBridgeError);
  return (err as DroidBridgeError).code;
}

describe('parseAvdList', () => {
  it('extracts AVD names from -list-avds output (CRLF, blanks, noise dropped)', () => {
    const stdout = [
      'Pixel_7_API_34',
      '',
      'pixel_5_api_33',
      'INFO | emulator: something',
      '-help',
      'Pixel_7_API_34',
      'My AVD 2',
    ].join('\r\n');
    expect(parseAvdList(stdout)).toEqual(['Pixel_7_API_34', 'pixel_5_api_33', 'My AVD 2']);
  });

  it('returns an empty list for empty output', () => {
    expect(parseAvdList('')).toEqual([]);
    expect(parseAvdList('\r\n\r\n')).toEqual([]);
  });

  it('caps the number of listed AVDs', () => {
    const many = Array.from({ length: 300 }, (_, i) => `avd_${i}`).join('\n');
    expect(parseAvdList(many)).toHaveLength(200);
  });
});

describe('buildEmulatorStartArgs', () => {
  it('passes the AVD name as exactly one argv entry', () => {
    expect(buildEmulatorStartArgs('Pixel_7_API_34')).toEqual(['-avd', 'Pixel_7_API_34']);
    expect(buildEmulatorStartArgs('My AVD 2')).toEqual(['-avd', 'My AVD 2']);
  });
});

describe('EmulatorManager.list', () => {
  it('runs emulator -list-avds and parses the names', async () => {
    const { manager, runs } = makeManager();
    const avds = await manager.list();
    expect(avds).toEqual(['Pixel_7_API_34', 'pixel_5_api_33']);
    expect(runs).toHaveLength(1);
    expect(runs[0].argv).toEqual(['-list-avds']);
    expect(runs[0].bin).toBe(FOUND.path);
  });

  it('fails honestly when the emulator is not installed', async () => {
    const { manager, runs } = makeManager({ locate: () => MISSING });
    const code = await rejectionCode(manager.list());
    expect(code).toBe('EMULATOR_NOT_FOUND');
    expect(runs).toHaveLength(0);
  });

  it('surfaces the emulator failure output when listing fails', async () => {
    const { manager } = makeManager({
      run: async () => runResult({ code: 1, stderr: 'PANIC: broken sdk' }),
    });
    const err = await manager.list().then(
      () => null,
      (e) => e as DroidBridgeError,
    );
    expect(err?.code).toBe('EMULATOR_LIST_FAILED');
    expect(err?.message).toContain('PANIC: broken sdk');
  });

  it('reports timeouts as a listing failure', async () => {
    const { manager } = makeManager({
      run: async () => runResult({ code: null, timedOut: true }),
    });
    const err = await manager.list().then(
      () => null,
      (e) => e as DroidBridgeError,
    );
    expect(err?.code).toBe('EMULATOR_LIST_FAILED');
    expect(err?.message).toMatch(/timed out/i);
  });

  it('filters names that could never be started again', async () => {
    const { manager } = makeManager({
      run: async () => runResult({ stdout: 'good_avd\r\n-injected\r\n../evil\r\n' }),
    });
    expect(await manager.list()).toEqual(['good_avd']);
  });
});

describe('EmulatorManager.start', () => {
  it('spawns the emulator, tracks it, and reports a clean exit', async () => {
    const { manager, registry, exits, spawned, child } = makeManager();
    const sessionId = await manager.start('Pixel_7_API_34');

    expect(sessionId).toBeTypeOf('string');
    expect(spawned).toEqual([{ bin: FOUND.path, argv: ['-avd', 'Pixel_7_API_34'] }]);
    expect(registry.has(`emulator:${sessionId}`)).toBe(true);
    expect(registry.list()[0].kind).toBe('emulator');

    (child as unknown as { emit: (e: string, code: number) => void }).emit('close', 0);
    expect(exits).toHaveLength(1);
    expect(exits[0]).toEqual({ sessionId, avd: 'Pixel_7_API_34', code: 0 });
    expect(registry.has(`emulator:${sessionId}`)).toBe(false);
  });

  it('fails honestly when the emulator is not installed', async () => {
    const { manager, registry, spawned } = makeManager({ locate: () => MISSING });
    const code = await rejectionCode(manager.start('Pixel_7_API_34'));
    expect(code).toBe('EMULATOR_NOT_FOUND');
    expect(spawned).toHaveLength(0);
    expect(registry.size()).toBe(0);
  });

  it('reports spawn errors once and cleans the registry', async () => {
    const { manager, registry, exits, child } = makeManager();
    const sessionId = await manager.start('Pixel_7_API_34');

    (child as unknown as { emit: (e: string, err: Error) => void }).emit(
      'error',
      Object.assign(new Error('spawn enoent'), { code: 'ENOENT' }),
    );
    expect(exits).toHaveLength(1);
    expect(exits[0].code).toBeNull();
    expect(exits[0].error).toContain('not found');
    expect(registry.has(`emulator:${sessionId}`)).toBe(false);

    // A late close must not double-report.
    (child as unknown as { emit: (e: string, code: number) => void }).emit('close', 1);
    expect(exits).toHaveLength(1);
  });

  it('captures emulator output as the exit error on failure', async () => {
    const { manager, exits, child } = makeManager();
    const sessionId = await manager.start('Pixel_7_API_34');

    emitData((child as unknown as { stderr: EventEmitter }).stderr, 'PANIC: unknown AVD name\r\n');
    (child as unknown as { emit: (e: string, code: number) => void }).emit('close', 1);

    expect(exits).toHaveLength(1);
    expect(exits[0].error).toContain('PANIC: unknown AVD name');
    expect(exits[0].sessionId).toBe(sessionId);
  });

  it('keeps the captured failure output bounded', async () => {
    const { manager, exits, child } = makeManager();
    await manager.start('Pixel_7_API_34');

    emitData((child as unknown as { stderr: EventEmitter }).stderr, 'x'.repeat(100_000));
    (child as unknown as { emit: (e: string, code: number) => void }).emit('close', 1);

    expect(exits[0].error).toBeDefined();
    expect(exits[0].error!.length).toBeLessThanOrEqual(4096);
  });

  it('drains stdout as well so the child can never block on a full pipe', async () => {
    const { manager, exits, child } = makeManager();
    await manager.start('Pixel_7_API_34');

    // No 'data' listener would exist only if the manager failed to drain;
    // emitting must be safe and produce no error entry for a clean exit.
    emitData((child as unknown as { stdout: EventEmitter }).stdout, 'lots of info\n');
    (child as unknown as { emit: (e: string, code: number) => void }).emit('close', 0);
    expect(exits[0].error).toBeUndefined();
  });
});
