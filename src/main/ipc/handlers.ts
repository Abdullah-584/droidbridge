import {
  assertDialogTitle,
  assertExternalUrl,
  assertHost,
  assertLogcatExport,
  assertLogcatOptions,
  assertPairCode,
  assertPort,
  assertProjectPath,
  assertAvdName,
  assertScrcpyOptions,
  assertSerial,
  assertSessionId,
  ValidationError,
} from '../../shared/validation';
import { runAdb } from '../adb/adb';
import type { LogcatManager } from '../adb/logcat';
import type { EmulatorManager } from '../services/emulator';
import type { ScrcpyManager } from '../services/scrcpy';
import { disconnectDevice, getDeviceDetails, listDevices, rebootDevice, runDiagnostics } from '../services/devices';
import { connectWireless, disconnectWireless, pairWireless, restartAdbServer } from '../services/pairing';
import {
  buildSystemStatus,
  openFolderInVSCode,
  runFlutterDevices,
  runFlutterDoctor,
  runFlutterPubGet,
} from '../services/tools';
import { exportLogcat } from '../services/exporter';
import type { HandlerSpecs } from './registry';
import type { BrowserWindow } from 'electron';

export interface HandlerDeps {
  logcat: LogcatManager;
  scrcpy: ScrcpyManager;
  emulator: EmulatorManager;
  appVersion: string;
  platform: string;
  getWindow: () => BrowserWindow | undefined;
  openExternal: (url: string) => void;
  pickFolder: (title: string) => Promise<string | null>;
  /** Applies a downloaded update (quit → installer → relaunch). */
  installUpdate: () => void;
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('Invalid request payload.');
  }
  return raw as Record<string, unknown>;
}

/** Builds the full, validated IPC handler map for the app. */
export function createHandlerSpecs(deps: HandlerDeps): HandlerSpecs {
  const noArgs = () => null;

  return {
    'system:status': {
      validate: noArgs,
      handle: () => buildSystemStatus(deps.appVersion, deps.platform),
    },
    'system:open-external': {
      validate: (raw) => ({ url: assertExternalUrl(asRecord(raw).url) }),
      handle: ({ url }) => {
        deps.openExternal(url);
        return null;
      },
    },
    'adb:restart-server': {
      validate: noArgs,
      handle: () => restartAdbServer(),
    },
    'devices:list': {
      validate: noArgs,
      handle: () => listDevices(),
    },
    'devices:details': {
      validate: (raw) => ({ serial: assertSerial(asRecord(raw).serial) }),
      handle: ({ serial }) => getDeviceDetails(serial),
    },
    'devices:diagnostics': {
      validate: (raw) => ({ serial: assertSerial(asRecord(raw).serial) }),
      handle: async ({ serial }) => runDiagnostics(serial),
    },
    'devices:reboot': {
      validate: (raw) => ({ serial: assertSerial(asRecord(raw).serial) }),
      handle: async ({ serial }) => {
        await rebootDevice(serial);
        return null;
      },
    },
    'devices:disconnect': {
      validate: (raw) => ({ serial: assertSerial(asRecord(raw).serial) }),
      handle: async ({ serial }) => {
        await disconnectDevice(serial);
        return null;
      },
    },
    'pairing:pair': {
      validate: (raw) => {
        const rec = asRecord(raw);
        return { host: assertHost(rec.host), port: assertPort(rec.port), code: assertPairCode(rec.code) };
      },
      handle: ({ host, port, code }) => pairWireless(host, port, code),
    },
    'pairing:connect': {
      validate: (raw) => {
        const rec = asRecord(raw);
        return { host: assertHost(rec.host), port: assertPort(rec.port) };
      },
      handle: ({ host, port }) => connectWireless(host, port),
    },
    'pairing:disconnect': {
      validate: (raw) => {
        const rec = asRecord(raw);
        return { host: assertHost(rec.host), port: assertPort(rec.port) };
      },
      handle: ({ host, port }) => disconnectWireless(host, port),
    },
    'logcat:start': {
      validate: (raw) => assertLogcatOptions(raw),
      handle: async ({ serial, buffers, level, filterSpecs }) => {
        const sessionId = await deps.logcat.start({ serial, buffers, level, filterSpecs });
        return { sessionId };
      },
    },
    'logcat:stop': {
      validate: (raw) => ({ sessionId: assertSessionId(asRecord(raw).sessionId) }),
      handle: ({ sessionId }) => {
        deps.logcat.stop(sessionId);
        return null;
      },
    },
    'logcat:clear': {
      validate: (raw) => ({ serial: assertSerial(asRecord(raw).serial) }),
      handle: async ({ serial }) => {
        const result = await runAdb(['logcat', '-c'], { serial, timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new ValidationError(result.stderr.trim() || 'adb logcat -c failed.');
        }
        return null;
      },
    },
    'logcat:sessions': {
      validate: noArgs,
      handle: () => ({ sessions: deps.logcat.sessions_() }),
    },
    'logcat:export': {
      validate: (raw) => assertLogcatExport(raw),
      handle: async ({ format, lines }) => exportLogcat(format, lines, deps.getWindow()),
    },
    'flutter:doctor': {
      validate: noArgs,
      handle: () => runFlutterDoctor(),
    },
    'flutter:devices': {
      validate: noArgs,
      handle: () => runFlutterDevices(),
    },
    'flutter:pub-get': {
      validate: (raw) => ({ projectPath: assertProjectPath(asRecord(raw).projectPath) }),
      handle: ({ projectPath }) => runFlutterPubGet(projectPath),
    },
    'vscode:open-folder': {
      validate: (raw) => ({ path: assertProjectPath(asRecord(raw).path) }),
      handle: async ({ path }) => {
        await openFolderInVSCode(path);
        return null;
      },
    },
    'dialogs:pick-folder': {
      validate: (raw) => ({ title: assertDialogTitle(asRecord(raw).title) }),
      handle: ({ title }) => deps.pickFolder(title),
    },
    'scrcpy:start': {
      validate: (raw) => assertScrcpyOptions(raw),
      handle: async (options) => {
        const sessionId = await deps.scrcpy.start(options);
        return { sessionId };
      },
    },
    'scrcpy:stop': {
      validate: (raw) => ({ sessionId: assertSessionId(asRecord(raw).sessionId) }),
      handle: ({ sessionId }) => {
        deps.scrcpy.stop(sessionId);
        return null;
      },
    },
    'emulator:list': {
      validate: noArgs,
      handle: async () => ({ avds: await deps.emulator.list() }),
    },
    'emulator:start': {
      validate: (raw) => ({ avd: assertAvdName(asRecord(raw).avd) }),
      handle: async ({ avd }) => ({ sessionId: await deps.emulator.start(avd) }),
    },
    'update:install': {
      validate: noArgs,
      handle: () => {
        deps.installUpdate();
        return null;
      },
    },
  };
}
