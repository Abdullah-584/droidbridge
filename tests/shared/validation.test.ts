import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  assertExternalUrl,
  assertHost,
  assertLogcatExport,
  assertLogcatOptions,
  assertPairCode,
  assertPort,
  assertProjectPath,
  assertScrcpyOptions,
  assertSerial,
  assertSessionId,
  isValidIpv4,
  isValidHost,
} from '../../src/shared/validation';
import type { LogcatLine } from '../../src/shared/types';

describe('assertSerial', () => {
  it('accepts USB serials, emulator ids and tcp endpoints', () => {
    expect(assertSerial('R58M12ABCD')).toBe('R58M12ABCD');
    expect(assertSerial('emulator-5554')).toBe('emulator-5554');
    expect(assertSerial('192.168.1.5:5555')).toBe('192.168.1.5:5555');
    expect(assertSerial('2b0a1a2e')).toBe('2b0a1a2e');
  });

  it('rejects shell metacharacters and oversized serials', () => {
    expect(() => assertSerial('abc; rm -rf /')).toThrow(ValidationError);
    expect(() => assertSerial('$(evil)')).toThrow(ValidationError);
    expect(() => assertSerial('a'.repeat(65))).toThrow(ValidationError);
    expect(() => assertSerial(42)).toThrow(ValidationError);
    expect(() => assertSerial(undefined)).toThrow(ValidationError);
  });
});

describe('host validation', () => {
  it('validates IPv4 octets', () => {
    expect(isValidIpv4('192.168.1.5')).toBe(true);
    expect(isValidIpv4('255.255.255.255')).toBe(true);
    expect(isValidIpv4('256.1.1.1')).toBe(false);
    expect(isValidIpv4('192.168.1')).toBe(false);
  });

  it('accepts hostnames and IPv6, rejects command injection shapes', () => {
    expect(isValidHost('my-device.local')).toBe(true);
    expect(isValidHost('::1')).toBe(true);
    expect(isValidHost('fe80::1%25')).toBe(false);
    expect(isValidHost('host & calc')).toBe(false);
    expect(isValidHost('`whoami`')).toBe(false);
    expect(isValidHost('')).toBe(false);
    expect(() => assertHost('not a host')).toThrow(ValidationError);
    expect(assertHost('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('assertPort', () => {
  it('accepts 1..65535 integers only', () => {
    expect(assertPort(5555)).toBe(5555);
    expect(assertPort(1)).toBe(1);
    expect(assertPort(65535)).toBe(65535);
    expect(() => assertPort(0)).toThrow(ValidationError);
    expect(() => assertPort(70000)).toThrow(ValidationError);
    expect(() => assertPort('5555')).toThrow(ValidationError);
    expect(() => assertPort(1.5)).toThrow(ValidationError);
  });
});

describe('assertPairCode', () => {
  it('requires exactly six digits', () => {
    expect(assertPairCode('123456')).toBe('123456');
    expect(() => assertPairCode('12345')).toThrow(ValidationError);
    expect(() => assertPairCode('1234567')).toThrow(ValidationError);
    expect(() => assertPairCode('abcdef')).toThrow(ValidationError);
  });
});

describe('assertSessionId', () => {
  it('accepts uuid-like ids and rejects everything else', () => {
    expect(assertSessionId('a1b2c3d4-e5f6')).toBe('a1b2c3d4-e5f6');
    expect(() => assertSessionId('../etc/passwd')).toThrow(ValidationError);
    expect(() => assertSessionId('short')).toThrow(ValidationError);
  });
});

describe('assertProjectPath', () => {
  it('accepts absolute Windows and POSIX paths', () => {
    expect(assertProjectPath('C:\\dev\\my app')).toBe('C:\\dev\\my app');
    expect(assertProjectPath('/home/user/project')).toBe('/home/user/project');
  });

  it('rejects relative paths and control characters', () => {
    expect(() => assertProjectPath('relative/path')).toThrow(ValidationError);
    expect(() => assertProjectPath('')).toThrow(ValidationError);
    expect(() => assertProjectPath('C:\\dev\u0000evil')).toThrow(ValidationError);
    expect(() => assertProjectPath(123)).toThrow(ValidationError);
  });
});

describe('assertExternalUrl', () => {
  it('allows http(s) only', () => {
    expect(assertExternalUrl('https://flutter.dev')).toContain('https://flutter.dev');
    expect(() => assertExternalUrl('file:///C:/Windows/System32/calc.exe')).toThrow(ValidationError);
    expect(() => assertExternalUrl('javascript:alert(1)')).toThrow(ValidationError);
    expect(() => assertExternalUrl('not a url')).toThrow(ValidationError);
  });
});

describe('assertLogcatOptions', () => {
  const valid = { serial: 'emulator-5554', buffers: ['main'], level: 'info', filterSpecs: ['ActivityManager:I'] };

  it('accepts valid options with defaults', () => {
    const parsed = assertLogcatOptions({ serial: 'emulator-5554' });
    expect(parsed).toEqual({ serial: 'emulator-5554', buffers: ['main'], level: 'verbose', filterSpecs: [] });
    expect(assertLogcatOptions(valid)).toEqual(valid);
  });

  it('rejects bad buffers, levels and filter specs', () => {
    expect(() => assertLogcatOptions({ ...valid, buffers: ['nope'] })).toThrow(ValidationError);
    expect(() => assertLogcatOptions({ ...valid, level: 'loud' })).toThrow(ValidationError);
    expect(() => assertLogcatOptions({ ...valid, filterSpecs: ['rm -rf *'] })).toThrow(ValidationError);
    expect(() => assertLogcatOptions({ ...valid, serial: 'x; drop' })).toThrow(ValidationError);
  });
});

describe('assertScrcpyOptions', () => {
  it('accepts bounded numeric options', () => {
    const parsed = assertScrcpyOptions({ serial: 'R58M12ABCD', maxFps: 60, bitrateMbps: 8, fullscreen: true });
    expect(parsed.maxFps).toBe(60);
    expect(parsed.bitrateMbps).toBe(8);
    expect(parsed.fullscreen).toBe(true);
  });

  it('rejects out-of-range and malformed options', () => {
    expect(() => assertScrcpyOptions({ serial: 'R58M12ABCD', maxFps: 0 })).toThrow(ValidationError);
    expect(() => assertScrcpyOptions({ serial: 'R58M12ABCD', maxFps: 1000 })).toThrow(ValidationError);
    expect(() => assertScrcpyOptions({ serial: 'R58M12ABCD', bitrateMbps: '8M' })).toThrow(ValidationError);
    expect(() => assertScrcpyOptions({ serial: 'R58M12ABCD', fullscreen: 'yes' })).toThrow(ValidationError);
    expect(() => assertScrcpyOptions({ serial: 'bad serial!', windowTitle: 'x' })).toThrow(ValidationError);
  });
});

describe('isValidHost', () => {
  it('rejects values with control characters', () => {
    expect(isValidHost('192.168.1.1\n')).toBe(false);
    expect(isValidHost('host\u0007')).toBe(false);
  });
});

describe('assertLogcatExport', () => {
  const line: LogcatLine = {
    seq: 1,
    raw: '10-18 22:57:33.123  1234  5678 I Tag: hello',
    time: '10-18 22:57:33.123',
    pid: 1234,
    tid: 5678,
    level: 'info',
    tag: 'Tag',
    message: 'hello',
  };

  it('accepts a well-formed payload and normalizes it', () => {
    expect(assertLogcatExport({ format: 'csv', lines: [line] })).toEqual({ format: 'csv', lines: [line] });
    expect(assertLogcatExport({ format: 'log', lines: [] }).lines).toEqual([]);
    expect(assertLogcatExport({ format: 'json', lines: [{ ...line, message: null }] }).format).toBe('json');
  });

  it('rejects unknown formats', () => {
    expect(() => assertLogcatExport({ format: 'pdf', lines: [] })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ lines: [] })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ format: 42, lines: [] })).toThrow(ValidationError);
  });

  it('rejects malformed line records', () => {
    expect(() => assertLogcatExport({ format: 'log', lines: 'not-an-array' })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ format: 'log', lines: ['raw string'] })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ format: 'log', lines: [{ ...line, seq: 'one' }] })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ format: 'log', lines: [{ ...line, pid: 1.5 }] })).toThrow(ValidationError);
    expect(() => assertLogcatExport({ format: 'log', lines: [{ ...line, level: 7 }] })).toThrow(ValidationError);
  });

  it('bounds per-line size and total payload', () => {
    expect(() => assertLogcatExport({ format: 'log', lines: [{ ...line, raw: 'x'.repeat(8193) }] })).toThrow(
      ValidationError,
    );
    expect(() => assertLogcatExport({ format: 'log', lines: [{ ...line, message: 'x'.repeat(8193) }] })).toThrow(
      ValidationError,
    );
    const many = Array.from({ length: 500_001 }, () => line);
    expect(() => assertLogcatExport({ format: 'log', lines: many })).toThrow(ValidationError);
  }, 30_000);
});
