import { describe, expect, it } from 'vitest';
import {
  batteryTone,
  deviceStateMeta,
  diagnosticStyle,
  filterLogLines,
  formatDuration,
  logLevelClass,
  timeAgo,
  transportLabel,
} from '../../src/renderer/lib/format';
import type { LogcatLine } from '../../src/shared/types';

function line(seq: number, raw: string, level: string | null): LogcatLine {
  return { seq, raw, time: null, pid: null, tid: null, level, tag: null, message: null };
}

describe('filterLogLines', () => {
  const lines = [
    line(1, 'D/verbose-ish debug', 'debug'),
    line(2, 'I/ready to go', 'info'),
    line(3, 'W/low memory', 'warn'),
    line(4, 'E/crashed hard', 'error'),
    line(5, 'no level line', null),
  ];

  it('filters by minimum level but keeps unparseable lines', () => {
    const warn = filterLogLines(lines, '', 'warn');
    expect(warn.map((l) => l.seq)).toEqual([3, 4, 5]);
    const error = filterLogLines(lines, '', 'error');
    expect(error.map((l) => l.seq)).toEqual([4, 5]);
  });

  it('searches case-insensitively as plain text', () => {
    expect(filterLogLines(lines, 'CRASHED', 'verbose').map((l) => l.seq)).toEqual([4]);
  });

  it('treats valid regex queries as regex and falls back to substring on bad regex', () => {
    expect(filterLogLines(lines, 'ready|memory', 'verbose').map((l) => l.seq)).toEqual([2, 3]);
    // '[' is an invalid regex — must degrade to literal matching, not throw.
    expect(filterLogLines(lines, '[', 'verbose')).toEqual([]);
    expect(filterLogLines(lines, 'no level', 'verbose').map((l) => l.seq)).toEqual([5]);
  });

  it('combines level and search', () => {
    expect(filterLogLines(lines, 'memory', 'error')).toEqual([]);
    expect(filterLogLines(lines, 'memory', 'warn').map((l) => l.seq)).toEqual([3]);
  });
});

describe('presentation helpers', () => {
  it('maps device states to display metadata', () => {
    expect(deviceStateMeta('device').label).toBe('Connected');
    expect(deviceStateMeta('unauthorized').label).toBe('Unauthorized');
    expect(deviceStateMeta('nonsense' as never).label).toBe('Unknown');
  });

  it('labels transports', () => {
    expect(transportLabel('usb')).toBe('USB');
    expect(transportLabel('tcp')).toBe('Wireless');
    expect(transportLabel('emulator')).toBe('Emulator');
  });

  it('styles diagnostics and levels', () => {
    expect(diagnosticStyle('pass')).toContain('emerald');
    expect(diagnosticStyle('fail')).toContain('rose');
    expect(logLevelClass('error')).toContain('rose');
    expect(logLevelClass(null)).toContain('slate');
  });

  it('formats durations and relative time', () => {
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(125_000)).toBe('2 m 5 s');
    expect(timeAgo('not-a-date')).toBe('never');
    expect(timeAgo(new Date().toISOString())).toBe('just now');
  });

  it('tones battery percentages', () => {
    expect(batteryTone(80)).toContain('emerald');
    expect(batteryTone(25)).toContain('amber');
    expect(batteryTone(5)).toContain('rose');
  });
});
