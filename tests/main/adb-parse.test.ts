import { describe, expect, it } from 'vitest';
import {
  classifyTransport,
  parseAdbDevicesOutput,
  parseDf,
  parseDumpsysBattery,
  parseFlutterDevices,
  parseGetProp,
  parseIpAddresses,
  parseLogcatLine,
  parseMemInfo,
} from '../../src/main/adb/parse';

const DEVICES_L_OUTPUT = `List of devices attached
* daemon not running; starting now at tcp:5037
* daemon started successfully
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
192.168.1.5:5555       device product:beyond1lte model:SM_G973F device:beyond1 transport_id:2 usb:1-1
R58M12ABCD             unauthorized transport_id:3
0123456789ABCDEF       no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html]
`;

describe('parseAdbDevicesOutput', () => {
  it('parses real `adb devices -l` output including daemon banners', () => {
    const devices = parseAdbDevicesOutput(DEVICES_L_OUTPUT);
    expect(devices).toHaveLength(4);

    const [emu, wireless, unauth, noperm] = devices;
    expect(emu.serial).toBe('emulator-5554');
    expect(emu.state).toBe('device');
    expect(emu.transport).toBe('emulator');
    expect(emu.model).toBe('sdk_gphone64_x86_64');

    expect(wireless.state).toBe('device');
    expect(wireless.transport).toBe('tcp');
    expect(wireless.ip).toBe('192.168.1.5');
    expect(wireless.port).toBe(5555);
    expect(wireless.model).toBe('SM_G973F');
    expect(wireless.usb).toBe('1-1');

    expect(unauth.state).toBe('unauthorized');
    expect(unauth.transport).toBe('usb');

    expect(noperm.state).toBe('no-permissions');
  });

  it('returns an empty list for empty output', () => {
    expect(parseAdbDevicesOutput('')).toEqual([]);
    expect(parseAdbDevicesOutput('List of devices attached\n\n')).toEqual([]);
  });
});

describe('classifyTransport', () => {
  it('classifies serials', () => {
    expect(classifyTransport('192.168.0.10:5555')).toBe('tcp');
    expect(classifyTransport('emulator-5556')).toBe('emulator');
    expect(classifyTransport('R58M12ABCD')).toBe('usb');
  });
});

describe('parseGetProp', () => {
  it('parses getprop output', () => {
    const props = parseGetProp('[ro.product.model]: [Pixel 7]\n[ro.build.version.sdk]: [34]\n[empty]: []\nnoise\n');
    expect(props['ro.product.model']).toBe('Pixel 7');
    expect(props['ro.build.version.sdk']).toBe('34');
    expect(props['empty']).toBe('');
    expect(Object.keys(props)).toHaveLength(3);
  });
});

describe('parseDumpsysBattery', () => {
  it('parses levels, temperature and charger state', () => {
    const battery = parseDumpsysBattery(
      `Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 85
  scale: 100
  voltage: 4123
  temperature: 290
  technology: Li-ion
`,
    );
    expect(battery).not.toBeNull();
    expect(battery?.level).toBe(85);
    expect(battery?.status).toBe('charging');
    expect(battery?.health).toBe('good');
    expect(battery?.temperatureC).toBeCloseTo(29);
    expect(battery?.plugged).toBe('USB');
  });

  it('returns null when no level is present', () => {
    expect(parseDumpsysBattery('no battery here')).toBeNull();
  });
});

describe('parseDf', () => {
  it('parses df -k mount points', () => {
    const entries = parseDf(
      `Filesystem        1K-blocks     Used Available Use% Mounted on
/dev/block/dm-6   113035268 51210728  61824540  46% /data
tmpfs              11562228     2348  11559880   1% /dev
`,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe('/data');
    expect(entries[0].usePct).toBe(46);
    expect(entries[0].avail).toBe('61824540');
  });
});

describe('parseMemInfo', () => {
  it('extracts total and available memory', () => {
    const mem = parseMemInfo('MemTotal:       11499216 kB\nMemFree:         123456 kB\nMemAvailable:    4567890 kB\n');
    expect(mem.totalKb).toBe(11499216);
    expect(mem.availableKb).toBe(4567890);
  });
});

describe('parseIpAddresses', () => {
  it('extracts non-loopback inet addresses', () => {
    const ips = parseIpAddresses(
      `1: lo: <LOOPBACK,UP> mtu 65536
    inet 127.0.0.1/8 scope host lo
2: wlan0: <BROADCAST,MULTICAST,UP> mtu 1500
    inet 192.168.1.5/24 brd 192.168.1.255 scope global wlan0
    inet6 fe80::1234:5678:9abc:def0/64 scope link
`,
    );
    expect(ips).toContain('192.168.1.5');
    expect(ips).toContain('fe80::1234:5678:9abc:def0');
    expect(ips).not.toContain('127.0.0.1');
  });
});

describe('parseLogcatLine', () => {
  it('parses threadtime lines', () => {
    const line = parseLogcatLine('10-18 22:57:33.123  1234  5678 I TestTag: hello world');
    expect(line.time).toBe('10-18 22:57:33.123');
    expect(line.pid).toBe(1234);
    expect(line.tid).toBe(5678);
    expect(line.level).toBe('info');
    expect(line.tag).toBe('TestTag');
    expect(line.message).toBe('hello world');
  });

  it('falls back to raw-only for unparseable lines', () => {
    const line = parseLogcatLine('--------- beginning of main');
    expect(line.level).toBeNull();
    expect(line.tag).toBeNull();
  });
});

describe('parseFlutterDevices', () => {
  it('parses the flutter devices table', () => {
    const devices = parseFlutterDevices(
      `22b2c1a • Pixel 7 • android-arm64 • Android 14 (API 34)
Windows • Windows 11 • windows-x64 • Microsoft Windows Version 23H2 22631.4317
`,
    );
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({ id: '22b2c1a', name: 'Pixel 7', targetType: 'android-arm64' });
  });

  it('ignores chatter lines', () => {
    expect(parseFlutterDevices('No devices detected.')).toEqual([]);
  });
});
