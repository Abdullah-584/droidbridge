import type {
  AdbDevice,
  DeviceDetails,
  DeviceListResult,
  DiagnosticCheck,
  DiagnosticReport,
  StorageEntry,
} from '../../shared/types';
import { getAdbToolInfo, runAdb } from '../adb/adb';
import { parseDf, parseGetProp, parseIpAddresses, parseMemInfo, parseAdbDevicesOutput, parseDumpsysBattery } from '../adb/parse';
import { DroidBridgeError } from '../errors';

const SHORT_TIMEOUT_MS = 10_000;

/** Lists devices from real `adb devices -l` output. */
export async function listDevices(): Promise<DeviceListResult> {
  const adb = await getAdbToolInfo();
  if (!adb.available || !adb.path) {
    return {
      devices: [],
      adb,
      raw: '',
      error: { code: 'ADB_NOT_FOUND', message: adb.hint ?? 'ADB was not found on this machine.' },
    };
  }
  const result = await runAdb(['devices', '-l'], { timeoutMs: 10_000, maxOutputBytes: 256 * 1024 });
  const raw = result.stdout;
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    return {
      devices: [],
      adb,
      raw,
      error: {
        code: 'ADB_ERROR',
        message: result.stderr.trim() || `adb exited with code ${result.code ?? 'unknown'}.`,
      },
    };
  }
  const devices = parseAdbDevicesOutput(raw);
  return { devices, adb, raw };
}

async function shell(serial: string, shellArgs: string[], timeoutMs = SHORT_TIMEOUT_MS): Promise<string> {
  const result = await runAdb(['shell', ...shellArgs], { serial, timeoutMs, maxOutputBytes: 512 * 1024 });
  return result.stdout;
}

/** Collects device properties and live state from several real adb calls. */
export async function getDeviceDetails(serial: string): Promise<DeviceDetails> {
  const warnings: string[] = [];

  const [propsOut, batteryOut, dfOut, memOut, sizeOut, densityOut, ipOut, selinuxOut] = await Promise.all([
    shell(serial, ['getprop']).catch((e) => {
      warnings.push(`getprop failed: ${e instanceof Error ? e.message : String(e)}`);
      return '';
    }),
    shell(serial, ['dumpsys', 'battery']).catch(() => ''),
    shell(serial, ['df', '-k']).catch(() => ''),
    shell(serial, ['cat', '/proc/meminfo']).catch(() => ''),
    shell(serial, ['wm', 'size']).catch(() => ''),
    shell(serial, ['wm', 'density']).catch(() => ''),
    shell(serial, ['ip', 'addr']).catch(async () => {
      const legacy = await shell(serial, ['ifconfig']).catch(() => '');
      return legacy;
    }),
    shell(serial, ['getenforce']).catch(() => ''),
  ]);

  const props = parseGetProp(propsOut);
  const battery = batteryOut ? parseDumpsysBattery(batteryOut) : null;
  const storage: StorageEntry[] = parseDf(dfOut);
  const memory = parseMemInfo(memOut);
  const size = /Physical size:\s*(\S+)/.exec(sizeOut)?.[1] ?? null;
  const overrideSize = /Override size:\s*(\S+)/.exec(sizeOut)?.[1] ?? null;
  const density = /Physical density:\s*(\S+)/.exec(densityOut)?.[1] ?? null;
  const overrideDensity = /Override density:\s*(\S+)/.exec(densityOut)?.[1] ?? null;
  const ipAddresses = parseIpAddresses(ipOut);
  const selinux = selinuxOut.trim() || null;

  const list = await listDevices();
  const device: AdbDevice | undefined = list.devices.find((d) => d.serial === serial);

  return {
    serial,
    state: device?.state ?? 'unknown',
    transport: device?.transport ?? 'unknown',
    model: props['ro.product.model'] ?? device?.model ?? null,
    brand: props['ro.product.brand'] ?? null,
    manufacturer: props['ro.product.manufacturer'] ?? null,
    androidVersion: props['ro.build.version.release'] ?? null,
    sdk: props['ro.build.version.sdk'] ?? null,
    abi: props['ro.product.cpu.abi'] ?? null,
    buildFingerprint: props['ro.build.fingerprint'] ?? null,
    ipAddresses,
    props: {
      'ro.build.version.release': props['ro.build.version.release'] ?? '',
      'ro.build.version.sdk': props['ro.build.version.sdk'] ?? '',
      'ro.product.model': props['ro.product.model'] ?? '',
      'ro.product.brand': props['ro.product.brand'] ?? '',
      'ro.product.manufacturer': props['ro.product.manufacturer'] ?? '',
      'ro.product.cpu.abi': props['ro.product.cpu.abi'] ?? '',
      'ro.build.type': props['ro.build.type'] ?? '',
      'ro.debuggable': props['ro.debuggable'] ?? '',
      'ro.secure': props['ro.secure'] ?? '',
      'ro.build.fingerprint': props['ro.build.fingerprint'] ?? '',
    },
    battery,
    storage,
    memory,
    display: { size: overrideSize ?? size, density: overrideDensity ?? density },
    selinux,
    collectedAt: new Date().toISOString(),
    warnings: warnings.filter(Boolean),
  };
}

function dataEntry(storage: StorageEntry[]): StorageEntry | undefined {
  return (
    storage.find((entry) => entry.path === '/data') ??
    storage.find((entry) => entry.path.startsWith('/data')) ??
    storage.find((entry) => entry.path === '/storage/emulated/0')
  );
}

/** Turns live device state into actionable pass/warn/fail/info checks. */
export async function runDiagnostics(serial: string, list?: DeviceListResult): Promise<DiagnosticReport> {
  const devices = list ?? (await listDevices());
  const device = devices.devices.find((d) => d.serial === serial);
  const checks: DiagnosticCheck[] = [];
  const errors: string[] = [];
  const collectedAt = new Date().toISOString();

  if (!device) {
    return {
      serial,
      collectedAt,
      checks: [
        {
          id: 'connection',
          label: 'Device reachable',
          status: 'fail',
          value: 'not listed by adb',
          hint: 'Re-plug the cable or reconnect the wireless device, then refresh.',
        },
      ],
      errors,
    };
  }

  if (device.state === 'device') {
    checks.push({ id: 'connection', label: 'ADB authorization', status: 'pass', value: 'authorized' });
  } else if (device.state === 'unauthorized') {
    checks.push({
      id: 'connection',
      label: 'ADB authorization',
      status: 'fail',
      value: 'unauthorized',
      hint: 'Unlock the device and accept the "Allow USB debugging?" prompt. DroidBridge never bypasses this prompt.',
    });
  } else if (device.state === 'no-permissions') {
    checks.push({
      id: 'connection',
      label: 'ADB authorization',
      status: 'fail',
      value: 'no permissions',
      hint: 'Check the USB cable/port and udev rules, then replug the device.',
    });
  } else {
    checks.push({
      id: 'connection',
      label: 'Device state',
      status: 'warn',
      value: device.state,
      hint: device.state === 'offline' ? 'The device dropped off the bus. Reconnect it or restart the ADB server.' : undefined,
    });
  }

  if (device.state !== 'device') {
    return { serial, collectedAt, checks, errors };
  }

  const details = await getDeviceDetails(serial);

  const battery = details.battery;
  if (battery) {
    checks.push({
      id: 'battery-level',
      label: 'Battery level',
      status: battery.level >= 20 ? 'pass' : battery.level >= 10 ? 'warn' : 'fail',
      value: `${battery.level}%${battery.plugged ? ` (${battery.plugged} powered)` : ''}`,
      hint: battery.level < 10 ? 'Battery is critically low; the device may shut down mid-flashing.' : undefined,
    });
    const temp = battery.temperatureC;
    checks.push({
      id: 'battery-temperature',
      label: 'Battery temperature',
      status: temp === undefined ? 'info' : temp < 40 ? 'pass' : temp < 45 ? 'warn' : 'fail',
      value: temp === undefined ? 'unknown' : `${temp.toFixed(1)} °C`,
      hint: temp !== undefined && temp >= 40 ? 'Device is hot; heavy builds/mirroring may throttle.' : undefined,
    });
    checks.push({
      id: 'battery-health',
      label: 'Battery health',
      status: battery.health === 'good' ? 'pass' : battery.health === 'unknown' ? 'info' : 'warn',
      value: battery.health,
    });
  } else {
    checks.push({ id: 'battery-level', label: 'Battery state', status: 'info', value: 'unavailable' });
  }

  const data = dataEntry(details.storage);
  if (data) {
    const availKb = Number(data.avail);
    const usePct = data.usePct ?? 0;
    checks.push({
      id: 'storage-data',
      label: 'Data partition space',
      status: usePct < 80 && availKb > 1_000_000 ? 'pass' : usePct < 92 && availKb > 200_000 ? 'warn' : 'fail',
      value: `${data.used} / ${data.size} used (${usePct}%)`,
      hint: usePct >= 92 ? 'Storage is nearly full; builds and installs will fail.' : undefined,
    });
  } else {
    checks.push({ id: 'storage-data', label: 'Data partition space', status: 'info', value: 'unavailable' });
  }

  const memAvailableKb = details.memory.availableKb;
  checks.push({
    id: 'memory',
    label: 'Available memory',
    status:
      memAvailableKb === null || memAvailableKb === undefined
        ? 'info'
        : memAvailableKb > 1_000_000
          ? 'pass'
          : memAvailableKb > 300_000
            ? 'warn'
            : 'fail',
    value:
      details.memory.totalKb && memAvailableKb
        ? `${(memAvailableKb / 1024 / 1024).toFixed(1)} GB free of ${(details.memory.totalKb / 1024 / 1024).toFixed(1)} GB`
        : 'unavailable',
    hint:
      memAvailableKb !== null && memAvailableKb !== undefined && memAvailableKb < 300_000
        ? 'Low memory: app launches and instrumentation tests may be killed by the OS.'
        : undefined,
  });

  checks.push({
    id: 'debuggable-build',
    label: 'Build type',
    status: details.props['ro.debuggable'] === '1' ? 'warn' : 'pass',
    value: details.props['ro.debuggable'] === '1' ? 'ro.debuggable=1 (userdebug/eng)' : 'user build',
    hint:
      details.props['ro.debuggable'] === '1'
        ? 'Debuggable system image: fine for development, not representative of production.'
        : undefined,
  });

  checks.push({
    id: 'selinux',
    label: 'SELinux',
    status:
      details.selinux === null ? 'info' : details.selinux.toLowerCase() === 'enforcing' ? 'pass' : 'warn',
    value: details.selinux ?? 'unavailable',
    hint:
      details.selinux && details.selinux.toLowerCase() !== 'enforcing'
        ? 'SELinux is not enforcing; security behaviour may differ from production.'
        : undefined,
  });

  checks.push({
    id: 'android-version',
    label: 'Android version / API',
    status: 'info',
    value: `${details.androidVersion ?? 'unknown'} (API ${details.sdk ?? '?'})`,
  });

  checks.push({
    id: 'display',
    label: 'Display',
    status: 'info',
    value: `${details.display.size ?? 'unknown'} @ ${details.display.density ?? '?'} dpi`,
  });

  checks.push({
    id: 'network',
    label: 'IP addresses',
    status: 'info',
    value: details.ipAddresses.length > 0 ? details.ipAddresses.join(', ') : 'none reported',
  });

  return { serial, collectedAt, checks, errors };
}

/** Reboots an authorized device (user-initiated, confirmed in the UI). */
export async function rebootDevice(serial: string): Promise<void> {
  const result = await runAdb(['reboot'], { serial, timeoutMs: 15_000 });
  if (result.code !== 0) {
    throw new DroidBridgeError('ADB_ERROR', result.stderr.trim() || `adb reboot exited with code ${result.code}.`);
  }
}

/** Disconnects a wireless endpoint (`adb disconnect host:port`). */
export async function disconnectDevice(serial: string): Promise<void> {
  const result = await runAdb(['disconnect', serial], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw new DroidBridgeError('ADB_ERROR', result.stderr.trim() || `adb disconnect exited with code ${result.code}.`);
  }
}
