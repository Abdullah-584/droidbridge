/**
 * Input validation for every value that crosses the IPC boundary.
 *
 * All functions throw `ValidationError` (code VALIDATION_ERROR); the IPC
 * registry converts it into a structured `{ ok: false }` result. Nothing here
 * builds shell strings — validated values are always passed to `spawn` as
 * individual argv entries.
 */

import type {
  AppError,
  LogcatBuffer,
  LogcatExportFormat,
  LogcatLine,
  LogcatOptions,
  ScrcpyOptions,
  ToolName,
} from './types';
import { LOGCAT_BUFFERS, LOGCAT_EXPORT_FORMATS, LOGCAT_LEVELS } from './types';

export class ValidationError extends Error implements AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly message: string;

  constructor(message: string) {
    super(message);
    this.message = message;
  }
}

const SERIAL_RE = /^[A-Za-z0-9._:\-]{1,64}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
const PAIR_CODE_RE = /^\d{6}$/;
const SESSION_ID_RE = /^[A-Za-z0-9\-_]{8,64}$/;
const FILTER_SPEC_RE = /^(\*|[A-Za-z0-9_.\-]+):([VvDdIiWwEeFfSs])$/;
const TAG_LEVEL_RE = /^[A-Za-z0-9_.\-*]{1,128}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const UNIFORMC_ABSOLUTE_RE = /^\/(?!\/)/;

/** Validates a device serial (`R58M12ABC`, `emulator-5554`, `192.168.1.5:5555`). */
export function assertSerial(raw: unknown): string {
  if (typeof raw !== 'string' || !SERIAL_RE.test(raw)) {
    throw new ValidationError('Invalid device serial.');
  }
  return raw;
}

/**
 * AVD names as produced by `emulator -list-avds`: a leading alphanumeric
 * character, then letters/digits/`.`/`_`/`-`/spaces, 1–64 chars total.
 * The leading-character rule rejects flag-shaped values (`-list-avds`) and
 * path-shaped values (`..`, `../evil`); spaces are allowed because Android
 * Studio ships defaults like `Pixel 7 API 34`.
 */
const AVD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\- ]{0,63}$/;

/** True for an AVD name DroidBridge will pass to `emulator -avd`. */
export function isValidAvdName(value: string): boolean {
  return AVD_NAME_RE.test(value) && value.trim() === value;
}

/**
 * Validates an AVD name crossing the IPC boundary. The name becomes a single
 * argv entry to `emulator -avd <name>` (never a shell string), but it is still
 * constrained so flag-shaped or path-shaped values can never be injected.
 */
export function assertAvdName(raw: unknown): string {
  if (typeof raw !== 'string' || !isValidAvdName(raw)) {
    throw new ValidationError('Invalid AVD name.');
  }
  return raw;
}

/** The tools DroidBridge can install automatically (zip download or winget). */
const INSTALLABLE_TOOLS = ['adb', 'flutter', 'scrcpy', 'code'] as const;

/**
 * Validates a tool-install request. The value is a closed enum — it can never
 * become a path, a URL fragment or any other free-form input downstream.
 */
export function assertInstallTool(raw: unknown): ToolName {
  if (typeof raw !== 'string' || !(INSTALLABLE_TOOLS as readonly string[]).includes(raw)) {
    throw new ValidationError('Invalid tool name.');
  }
  return raw as ToolName;
}

/** Returns true when the string is a valid IPv4 address (each octet ≤ 255). */
export function isValidIpv4(value: string): boolean {
  const m = IPV4_RE.exec(value);
  if (!m) return false;
  return m.slice(1, 5).every((octet) => Number(octet) <= 255);
}

/** Hostnames, IPv4 and IPv6 literals are all acceptable connection targets. */
export function isValidHost(value: string): boolean {
  if (value.length === 0 || value.length > 253 || CONTROL_CHARS_RE.test(value)) return false;
  if (isValidIpv4(value)) return true;
  if (value.includes(':')) return IPV6_RE.test(value) && value.includes(':');
  return HOSTNAME_RE.test(value);
}

export function assertHost(raw: unknown): string {
  if (typeof raw !== 'string' || !isValidHost(raw)) {
    throw new ValidationError('Invalid host. Use an IPv4 address, IPv6 address or hostname.');
  }
  return raw;
}

export function assertPort(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 65535) {
    throw new ValidationError('Invalid port. Expected an integer between 1 and 65535.');
  }
  return raw;
}

/** The Android wireless-debugging pairing code is exactly six digits. */
export function assertPairCode(raw: unknown): string {
  if (typeof raw !== 'string' || !PAIR_CODE_RE.test(raw)) {
    throw new ValidationError('Invalid pairing code. It must be exactly 6 digits.');
  }
  return raw;
}

export function assertSessionId(raw: unknown): string {
  if (typeof raw !== 'string' || !SESSION_ID_RE.test(raw)) {
    throw new ValidationError('Invalid session id.');
  }
  return raw;
}

/**
 * Absolute filesystem path for project-level actions (Flutter pub get, VS Code).
 * Only absolute Windows or POSIX paths with no control characters are accepted.
 */
export function assertProjectPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    throw new ValidationError('Invalid path.');
  }
  if (CONTROL_CHARS_RE.test(raw)) {
    throw new ValidationError('Path must not contain control characters.');
  }
  if (!WINDOWS_ABSOLUTE_RE.test(raw) && !UNIFORMC_ABSOLUTE_RE.test(raw)) {
    throw new ValidationError('Path must be absolute.');
  }
  return raw;
}

/** Only http(s) URLs may leave the app via the shell. */
export function assertExternalUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048 || CONTROL_CHARS_RE.test(raw)) {
    throw new ValidationError('Invalid URL.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('Only http(s) URLs can be opened.');
  }
  return url.toString();
}

export function assertDialogTitle(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 120 || CONTROL_CHARS_RE.test(raw)) {
    throw new ValidationError('Invalid dialog title.');
  }
  return raw;
}

const MAX_EXPORT_LINES = 500_000;
const MAX_LINE_FIELD = 8192;

function optionalBoundedString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new ValidationError(`Invalid log line ${field}.`);
  }
  return value;
}

function optionalInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Invalid log line ${field}.`);
  }
  return value;
}

function assertLogcatLine(raw: unknown): LogcatLine {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('Invalid log export line.');
  }
  const input = raw as Record<string, unknown>;
  const seq = optionalInt(input.seq, 'seq');
  if (seq === null) {
    throw new ValidationError('Invalid log line seq.');
  }
  return {
    seq,
    raw: optionalBoundedString(input.raw, 'raw', MAX_LINE_FIELD) ?? '',
    time: optionalBoundedString(input.time, 'time', 64),
    pid: optionalInt(input.pid, 'pid'),
    tid: optionalInt(input.tid, 'tid'),
    level: optionalBoundedString(input.level, 'level', 16),
    tag: optionalBoundedString(input.tag, 'tag', MAX_LINE_FIELD),
    message: optionalBoundedString(input.message, 'message', MAX_LINE_FIELD),
  };
}

/** Validates a structured logcat export request (format + parsed lines). */
export function assertLogcatExport(
  raw: unknown,
): { format: LogcatExportFormat; lines: LogcatLine[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('Invalid log export payload.');
  }
  const input = raw as Record<string, unknown>;
  const format = input.format;
  if (typeof format !== 'string' || !(LOGCAT_EXPORT_FORMATS as readonly string[]).includes(format)) {
    throw new ValidationError('Invalid export format.');
  }
  const lines = input.lines;
  if (!Array.isArray(lines) || lines.length > MAX_EXPORT_LINES) {
    throw new ValidationError('Invalid log export payload.');
  }
  return {
    format: format as LogcatExportFormat,
    lines: lines.map((line) => assertLogcatLine(line)),
  };
}

const LOGCAT_LEVEL_RANK: Record<string, number> = {
  verbose: 2,
  debug: 3,
  info: 4,
  warn: 5,
  error: 6,
  fatal: 7,
  silent: 8,
};

export function logLevelRank(level: string): number {
  return LOGCAT_LEVEL_RANK[level] ?? 2;
}

/** Maps single-letter logcat priorities to the internal level rank. */
export function letterLevelRank(letter: string): number {
  switch (letter.toUpperCase()) {
    case 'V':
      return 2;
    case 'D':
      return 3;
    case 'I':
      return 4;
    case 'W':
      return 5;
    case 'E':
      return 6;
    case 'F':
      return 7;
    case 'S':
      return 8;
    default:
      return 2;
  }
}

function isLevel(value: unknown): value is LogcatOptions['level'] {
  return typeof value === 'string' && (LOGCAT_LEVELS as readonly string[]).includes(value);
}

export function assertLogcatOptions(raw: unknown): LogcatOptions {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('Invalid logcat options.');
  }
  const input = raw as Record<string, unknown>;
  const serial = assertSerial(input.serial);

  const buffers: LogcatBuffer[] = [];
  const rawBuffers = input.buffers === undefined ? ['main'] : input.buffers;
  if (!Array.isArray(rawBuffers) || rawBuffers.length === 0 || rawBuffers.length > LOGCAT_BUFFERS.length) {
    throw new ValidationError('Invalid logcat buffers.');
  }
  for (const buffer of rawBuffers) {
    if (typeof buffer !== 'string' || !(LOGCAT_BUFFERS as readonly string[]).includes(buffer)) {
      throw new ValidationError('Invalid logcat buffer.');
    }
    if (!buffers.includes(buffer as LogcatBuffer)) buffers.push(buffer as LogcatBuffer);
  }

  const level = input.level === undefined ? 'verbose' : input.level;
  if (!isLevel(level)) {
    throw new ValidationError('Invalid log level.');
  }

  const filterSpecs: string[] = [];
  const rawSpecs = input.filterSpecs === undefined ? [] : input.filterSpecs;
  if (!Array.isArray(rawSpecs) || rawSpecs.length > 16) {
    throw new ValidationError('Invalid filter specs.');
  }
  for (const spec of rawSpecs) {
    if (typeof spec !== 'string' || !FILTER_SPEC_RE.test(spec) || !TAG_LEVEL_RE.test(spec.split(':')[0])) {
      throw new ValidationError(`Invalid filter spec: expected TAG:PRIORITY (e.g. ActivityManager:I).`);
    }
    filterSpecs.push(spec);
  }

  return { serial, buffers, level, filterSpecs };
}

function optionalBoundedInt(value: unknown, min: number, max: number, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`Invalid ${field}. Expected an integer between ${min} and ${max}.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new ValidationError(`Invalid ${field}. Expected true or false.`);
  }
  return value;
}

export function assertScrcpyOptions(raw: unknown): ScrcpyOptions {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('Invalid scrcpy options.');
  }
  const input = raw as Record<string, unknown>;
  const serial = assertSerial(input.serial);
  const maxFps = optionalBoundedInt(input.maxFps, 1, 240, 'maxFps');
  const bitrateMbps = optionalBoundedInt(input.bitrateMbps, 1, 100, 'bitrateMbps');
  const alwaysOnTop = optionalBoolean(input.alwaysOnTop, 'alwaysOnTop');
  const fullscreen = optionalBoolean(input.fullscreen, 'fullscreen');
  const noAudio = optionalBoolean(input.noAudio, 'noAudio');

  let windowTitle: string | undefined;
  if (input.windowTitle !== undefined && input.windowTitle !== null) {
    if (
      typeof input.windowTitle !== 'string' ||
      input.windowTitle.length > 120 ||
      CONTROL_CHARS_RE.test(input.windowTitle)
    ) {
      throw new ValidationError('Invalid window title.');
    }
    windowTitle = input.windowTitle;
  }

  return { serial, maxFps, bitrateMbps, alwaysOnTop, fullscreen, noAudio, windowTitle };
}

/** Builds the validated Result envelope shape used across the IPC boundary. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err(code: string, message: string): { ok: false; error: AppError } {
  return { ok: false, error: { code, message } };
}
