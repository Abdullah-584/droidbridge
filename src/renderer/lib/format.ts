import type { DeviceState, DiagnosticStatus, LogcatLine, LogLevel } from '../../shared/types';
import { logLevelRank } from '../../shared/validation';

export interface Tone {
  dot: string;
  text: string;
  label: string;
}

const STATE_META: Record<DeviceState, Tone> = {
  device: { dot: 'bg-ok', text: 'text-ok', label: 'Connected' },
  unauthorized: { dot: 'bg-warn', text: 'text-warn', label: 'Unauthorized' },
  authorizing: { dot: 'bg-warn', text: 'text-warn', label: 'Authorizing' },
  offline: { dot: 'bg-err', text: 'text-err', label: 'Offline' },
  'no-permissions': { dot: 'bg-err', text: 'text-err', label: 'No permissions' },
  recovery: { dot: 'bg-info', text: 'text-info', label: 'Recovery' },
  sideload: { dot: 'bg-info', text: 'text-info', label: 'Sideload' },
  rescue: { dot: 'bg-info', text: 'text-info', label: 'Rescue' },
  unknown: { dot: 'bg-dim', text: 'text-muted', label: 'Unknown' },
};

export function deviceStateMeta(state: DeviceState): Tone {
  return STATE_META[state] ?? STATE_META.unknown;
}

export function transportLabel(transport: string): string {
  switch (transport) {
    case 'usb':
      return 'USB';
    case 'tcp':
      return 'Wireless';
    case 'emulator':
      return 'Emulator';
    default:
      return 'Unknown';
  }
}

const DIAGNOSTIC_STYLES: Record<DiagnosticStatus, string> = {
  pass: 'text-ok bg-ok/10 border-ok/25',
  warn: 'text-warn bg-warn/10 border-warn/25',
  fail: 'text-err bg-err/10 border-err/25',
  info: 'text-info bg-info/10 border-info/25',
};

export function diagnosticStyle(status: DiagnosticStatus): string {
  return DIAGNOSTIC_STYLES[status] ?? DIAGNOSTIC_STYLES.info;
}

export const LOG_LEVEL_CLASS: Record<string, string> = {
  verbose: 'text-dim',
  debug: 'text-info',
  info: 'text-ok',
  warn: 'text-warn',
  error: 'text-err',
  fatal: 'text-err font-semibold',
};

export function logLevelClass(level: string | null): string {
  return (level && LOG_LEVEL_CLASS[level]) || 'text-dim';
}

/**
 * Client-side logcat filtering: minimum level plus a case-insensitive search
 * (regex when the query looks like one, plain substring otherwise).
 */
export function filterLogLines(lines: LogcatLine[], search: string, minLevel: LogLevel): LogcatLine[] {
  const minRank = logLevelRank(minLevel);
  const trimmed = search.trim();
  let matcher: ((text: string) => boolean) | null = null;
  if (trimmed.length > 0) {
    try {
      const re = new RegExp(trimmed, 'i');
      matcher = (text) => re.test(text);
    } catch {
      const needle = trimmed.toLowerCase();
      matcher = (text) => text.toLowerCase().includes(needle);
    }
  }
  return lines.filter((line) => {
    // `line.level` is a full name ("warn", "error", …) straight from the parser.
    if (line.level && logLevelRank(line.level) < minRank) return false;
    if (!matcher) return true;
    return matcher(line.raw);
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function batteryTone(level: number): string {
  if (level >= 40) return 'text-ok';
  if (level >= 20) return 'text-warn';
  return 'text-err';
}
