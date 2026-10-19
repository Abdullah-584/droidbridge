import type { DeviceListResult, PairResult } from '../../shared/types';
import { invalidateAdbCache, runAdb } from '../adb/adb';
import { listDevices } from './devices';

/** Formats host+port as an adb endpoint (IPv6 hosts get bracketed). */
export function formatEndpoint(host: string, port: number): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

function summarize(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'));
  return lines.join(' ') || 'No output from adb.';
}

/**
 * Pairs with a device via Android's wireless debugging pairing flow.
 * The six-digit on-screen pairing code comes from the device; this only runs
 * `adb pair` and reports the real result — authorization is never bypassed.
 */
export async function pairWireless(host: string, port: number, code: string): Promise<PairResult> {
  const endpoint = formatEndpoint(host, port);
  const result = await runAdb(['pair', endpoint, code], { timeoutMs: 45_000, maxOutputBytes: 64 * 1024 });
  const output = `${result.stdout}${result.stderr}`.trim();
  const paired = /successfully paired/i.test(output) && !/failed/i.test(output);
  return {
    paired,
    message: paired ? `Paired with ${endpoint}.` : summarize(output),
    output,
  };
}

/** Connects to a previously paired wireless device. */
export async function connectWireless(host: string, port: number): Promise<PairResult> {
  const endpoint = formatEndpoint(host, port);
  const result = await runAdb(['connect', endpoint], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  const output = `${result.stdout}${result.stderr}`.trim();
  const connected = /connected to/i.test(output) && !/cannot connect/i.test(output);
  return {
    paired: connected,
    message: connected ? `Connected to ${endpoint}.` : summarize(output),
    output,
  };
}

/** Disconnects a wireless endpoint. */
export async function disconnectWireless(host: string, port: number): Promise<PairResult> {
  const endpoint = formatEndpoint(host, port);
  const result = await runAdb(['disconnect', endpoint], { timeoutMs: 15_000, maxOutputBytes: 64 * 1024 });
  const output = `${result.stdout}${result.stderr}`.trim();
  return { paired: true, message: summarize(output), output };
}

/** Restarts the adb server (`kill-server` + `start-server`) and re-lists. */
export async function restartAdbServer(): Promise<DeviceListResult> {
  await runAdb(['kill-server'], { timeoutMs: 10_000 }).catch(() => undefined);
  const started = await runAdb(['start-server'], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  invalidateAdbCache();
  if (started.code !== 0) {
    return {
      devices: [],
      adb: { tool: 'adb', available: true, path: null, version: null, source: 'path' },
      raw: '',
      error: {
        code: 'ADB_SERVER_START_FAILED',
        message: started.stderr.trim() || `adb start-server exited with code ${started.code}.`,
      },
    };
  }
  return listDevices();
}
