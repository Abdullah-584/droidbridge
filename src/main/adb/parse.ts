import type { AdbDevice, BatteryInfo, DeviceState, DeviceTransport, StorageEntry } from '../../shared/types';

const DEVICE_STATES: readonly DeviceState[] = [
  'device',
  'offline',
  'unauthorized',
  'authorizing',
  'no-permissions',
  'recovery',
  'sideload',
  'rescue',
];

const TCP_SERIAL_RE = /^(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9\-._]+):(\d{1,5})$/;

/** Classifies a serial as a network endpoint, emulator or USB device. */
export function classifyTransport(serial: string): DeviceTransport {
  if (serial.startsWith('emulator-')) return 'emulator';
  const match = TCP_SERIAL_RE.exec(serial);
  if (match) return 'tcp';
  return 'usb';
}

function normalizeState(token: string, nextToken?: string): DeviceState {
  if (token === 'no' && nextToken === 'permissions') return 'no-permissions';
  return (DEVICE_STATES as readonly string[]).includes(token) ? (token as DeviceState) : 'unknown';
}

/**
 * Parses `adb devices -l` output. Lines that do not look like a device entry
 * (daemon banners, headers, blanks) are ignored.
 */
export function parseAdbDevicesOutput(output: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('*')) continue;
    if (line.startsWith('List of devices')) continue;
    if (line.startsWith('adb server version')) continue;
    if (line.startsWith('failed to')) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;

    const serial = tokens[0];
    const state = normalizeState(tokens[1], tokens[2]);
    const attrs = new Map<string, string>();
    for (const token of tokens.slice(state === 'no-permissions' ? 3 : 2)) {
      const idx = token.indexOf(':');
      if (idx > 0) attrs.set(token.slice(0, idx), token.slice(idx + 1));
    }

    const tcp = state !== 'no-permissions' ? TCP_SERIAL_RE.exec(serial) : null;
    const device: AdbDevice = {
      serial,
      state,
      transport: classifyTransport(serial),
      product: attrs.get('product'),
      model: attrs.get('model') ?? attrs.get('device'),
      deviceName: attrs.get('device'),
      transportId: attrs.get('transport_id'),
      usb: attrs.get('usb'),
      ip: tcp ? tcp[1].replace(/^\[|\]$/g, '') : undefined,
      port: tcp ? Number(tcp[2]) : undefined,
    };
    devices.push(device);
  }
  return devices;
}

/** Parses `getprop` output: lines shaped like `[key]: [value]`. */
export function parseGetProp(output: string): Record<string, string> {
  const props: Record<string, string> = {};
  const re = /^\[([^\]]+)\]: \[(.*)\]$/;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('[')) continue;
    const match = re.exec(line);
    if (match) props[match[1]] = match[2];
  }
  return props;
}

const BATTERY_STATUS: Record<number, string> = {
  1: 'unknown',
  2: 'charging',
  3: 'discharging',
  4: 'not charging',
  5: 'full',
};

const BATTERY_HEALTH: Record<number, string> = {
  1: 'unknown',
  2: 'good',
  3: 'overheat',
  4: 'dead',
  5: 'over voltage',
  6: 'failure',
  7: 'cold',
};

/** Parses `dumpsys battery`. */
export function parseDumpsysBattery(output: string): BatteryInfo | null {
  const fields = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z ]+):\s*(.*)$/.exec(rawLine);
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  const level = Number(fields.get('level'));
  if (!Number.isFinite(level) || !fields.has('level')) return null;

  const scale = Number(fields.get('scale') ?? '100');
  const status = Number(fields.get('status') ?? '-1');
  const health = Number(fields.get('health') ?? '-1');
  const temperature = Number(fields.get('temperature'));
  const voltage = Number(fields.get('voltage'));

  const plugged =
    fields.get('ac powered') === 'true'
      ? 'AC'
      : fields.get('usb powered') === 'true'
        ? 'USB'
        : fields.get('wireless powered') === 'true'
          ? 'wireless'
          : undefined;

  return {
    level,
    scale: Number.isFinite(scale) ? scale : 100,
    status: BATTERY_STATUS[status] ?? 'unknown',
    health: BATTERY_HEALTH[health] ?? 'unknown',
    temperatureC: Number.isFinite(temperature) ? temperature / 10 : undefined,
    voltageMv: Number.isFinite(voltage) ? voltage : undefined,
    plugged,
  };
}

/** Parses `df -k` output into storage entries (mount points only). */
export function parseDf(output: string): StorageEntry[] {
  const entries: StorageEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 6) continue;
    const [filesystem, size, used, avail, usePct, ...rest] = tokens;
    if (filesystem === 'Filesystem') continue;
    if (!/^\d+%$/.test(usePct)) continue;
    entries.push({
      path: rest.join(' ') || '/',
      size,
      used,
      avail,
      usePct: Number.parseInt(usePct, 10),
    });
  }
  return entries;
}

/** Parses /proc/meminfo. */
export function parseMemInfo(output: string): { totalKb: number | null; availableKb: number | null } {
  let totalKb: number | null = null;
  let availableKb: number | null = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^(MemTotal|MemAvailable):\s*(\d+)\s*kB/i.exec(rawLine.trim());
    if (!match) continue;
    const value = Number(match[2]);
    if (match[1].toLowerCase() === 'memtotal') totalKb = value;
    else availableKb = value;
  }
  return { totalKb, availableKb };
}

/** Extracts IPv4/IPv6 addresses from `ip addr` / `ifconfig` style output. */
export function parseIpAddresses(output: string): string[] {
  const found = new Set<string>();
  const re = /\binet6?\s+([0-9a-fA-F:.]+)(?:\/\d+)?\b/g;
  for (const line of output.split(/\r?\n/)) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const addr = match[1];
      if (addr === '::1' || addr === '127.0.0.1' || addr === '::') continue;
      found.add(addr);
    }
  }
  return [...found];
}

const LOGCAT_THREADTIME_RE =
  /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+([^:]*):\s?(.*)$/;

export interface ParsedLogcatLine {
  time: string | null;
  pid: number | null;
  tid: number | null;
  level: string | null;
  tag: string | null;
  message: string | null;
}

const LEVEL_NAMES: Record<string, string> = {
  V: 'verbose',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  F: 'fatal',
  S: 'silent',
};

/** Parses a `logcat -v threadtime` line; falls back to raw-only fields. */
export function parseLogcatLine(raw: string): ParsedLogcatLine {
  const match = LOGCAT_THREADTIME_RE.exec(raw);
  if (!match) {
    return { time: null, pid: null, tid: null, level: null, tag: null, message: null };
  }
  return {
    time: match[1],
    pid: Number(match[2]),
    tid: Number(match[3]),
    level: LEVEL_NAMES[match[4]] ?? null,
    tag: match[5].trim() || null,
    message: match[6],
  };
}

/** Parses `flutter devices` table output. */
export function parseFlutterDevices(raw: string): { id: string; name: string; targetType: string }[] {
  const devices: { id: string; name: string; targetType: string }[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('No devices') || line.startsWith('If you ') || line.startsWith('Run ')) continue;
    if (!line.includes('•')) continue;
    const cells = line.split('•').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const [id, name, targetType] = cells;
    if (!id || id.toLowerCase() === 'id') continue;
    devices.push({ id, name: name || 'Unknown device', targetType: targetType || 'unknown' });
  }
  return devices;
}
