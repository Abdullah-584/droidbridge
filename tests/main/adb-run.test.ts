import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertBatchSafeArg,
  buildBatchCommandLine,
  isBatchFile,
  resolveExecutable,
  runCommand,
} from '../../src/main/adb/run';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droidbridge-run-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, body: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

describe('runCommand', () => {
  it('captures stdout, exit code and duration', async () => {
    const result = await runCommand(process.execPath, ['-e', 'console.log("hello"); process.exit(7)']);
    expect(result.code).toBe(7);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
  });

  it('never interprets arguments as shell syntax', async () => {
    const nasty = 'x&echo INJECTED|calc';
    const result = await runCommand(process.execPath, ['-e', 'console.log(process.argv[1])', nasty]);
    expect(result.stdout.trim()).toBe(nasty);
  });

  it('kills long-running processes on timeout', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    expect(result.killed).toBe(true);
  });

  it('caps output and reports truncation', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', 'process.stdout.write("a".repeat(200000))'],
      { maxOutputBytes: 1000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1000);
  });

  it('rejects NUL bytes in arguments', async () => {
    await expect(runCommand(process.execPath, ['a\u0000b'])).rejects.toThrow(/plain strings/);
  });

  it('rejects an empty executable', async () => {
    await expect(runCommand('', [])).rejects.toThrow(/Executable path is invalid/);
  });
});

describe('batch file handling (win32)', () => {
  const fixture = writeFixture(
    'fixture.cmd',
    '@echo off\r\necho arg1=%1\r\necho fixture ran\r\nexit /b 3\r\n',
  );

  it('detects batch files only on win32', () => {
    expect(isBatchFile(fixture)).toBe(process.platform === 'win32');
    expect(isBatchFile(process.execPath)).toBe(false);
  });

  it('wraps bin and args in a doubly-quoted cmd /s /c line', () => {
    const line = buildBatchCommandLine('C:\\tools\\x.cmd', ['a b', 'c']);
    expect(line).toBe('""C:\\tools\\x.cmd" "a b" "c""');
  });

  it('rejects cmd metacharacters in batch arguments', () => {
    expect(() => assertBatchSafeArg('has"quote')).toThrow(/not supported/);
    expect(() => assertBatchSafeArg('%PATH%')).toThrow(/not supported/);
    expect(() => assertBatchSafeArg('a&b')).toThrow(/not supported/);
    expect(() => assertBatchSafeArg('a(b)')).toThrow(/not supported/);
    expect(() => buildBatchCommandLine('x.cmd', ['%USERPROFILE%'])).toThrow(/not supported/);
    expect(() => buildBatchCommandLine('x.cmd', ['C:\\dev\\My App'])).not.toThrow();
  });

  it.runIf(process.platform === 'win32')(
    'executes .cmd fixtures with quoted args and real exit codes',
    async () => {
      const result = await runCommand(fixture, ['a b', 'second']);
      expect(result.code).toBe(3);
      expect(result.stdout).toContain('fixture ran');
      expect(result.stdout).toContain('a b');
    },
  );

  it.runIf(process.platform === 'win32')(
    'refuses cmd metacharacters for batch executables before spawning',
    async () => {
      await expect(runCommand(fixture, ['x&echo INJECTED'])).rejects.toThrow(/not supported/);
    },
  );

  it('resolveExecutable leaves real executables untouched', () => {
    const resolved = resolveExecutable(process.execPath, ['-e', '0']);
    expect(resolved.bin).toBe(process.execPath);
    expect(resolved.argv).toEqual(['-e', '0']);
  });
});
