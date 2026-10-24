/**
 * Shared IPC contract types for DroidBridge.
 *
 * This module is imported by the Electron main process, the preload bridge and
 * the renderer. It must stay free of Node.js built-ins so it can be bundled
 * into the sandboxed preload script.
 */

/** Uniform result envelope: every IPC invoke resolves to this shape. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface AppError {
  /** Machine readable code, e.g. VALIDATION_ERROR, ADB_NOT_FOUND. */
  code: string;
  /** Human readable message safe to show in the UI. */
  message: string;
  /** Optional structured details (already sanitized for display). */
  details?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolName = 'adb' | 'flutter' | 'scrcpy' | 'code';
export type ToolSource = 'env' | 'registry' | 'path' | 'default-location' | 'not-found';

export interface ToolInfo {
  tool: ToolName;
  available: boolean;
  /** Absolute path to the executable, or null when not found. */
  path: string | null;
  /** First line of the tool's version output, or null when unknown. */
  version: string | null;
  source: ToolSource;
  /** Optional hint shown in the UI when the tool is missing. */
  hint?: string;
}

export interface SystemStatus {
  appVersion: string;
  platform: string;
  adb: ToolInfo;
  flutter: ToolInfo;
  scrcpy: ToolInfo;
  vscode: ToolInfo;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export type DeviceState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'authorizing'
  | 'no-permissions'
  | 'recovery'
  | 'sideload'
  | 'rescue'
  | 'unknown';

export type DeviceTransport = 'usb' | 'tcp' | 'emulator' | 'unknown';

export interface AdbDevice {
  serial: string;
  state: DeviceState;
  transport: DeviceTransport;
  product?: string;
  model?: string;
  deviceName?: string;
  transportId?: string;
  usb?: string;
  ip?: string;
  port?: number;
}

export interface DeviceListResult {
  devices: AdbDevice[];
  adb: ToolInfo;
  /** Raw `adb devices -l` output (truncated) for the advanced panel. */
  raw: string;
  error?: AppError;
}

export interface BatteryInfo {
  level: number;
  scale: number;
  status: string;
  health: string;
  temperatureC?: number;
  voltageMv?: number;
  plugged?: string;
}

export interface StorageEntry {
  path: string;
  size: string;
  used: string;
  avail: string;
  usePct?: number;
}

export interface DeviceDetails {
  serial: string;
  state: DeviceState;
  transport: DeviceTransport;
  model: string | null;
  brand: string | null;
  manufacturer: string | null;
  androidVersion: string | null;
  sdk: string | null;
  abi: string | null;
  buildFingerprint: string | null;
  ipAddresses: string[];
  props: Record<string, string>;
  battery: BatteryInfo | null;
  storage: StorageEntry[];
  memory: { totalKb: number | null; availableKb: number | null };
  display: { size: string | null; density: string | null };
  selinux: string | null;
  collectedAt: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  value: string;
  hint?: string;
}

export interface DiagnosticReport {
  serial: string;
  collectedAt: string;
  checks: DiagnosticCheck[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Logcat
// ---------------------------------------------------------------------------

export const LOGCAT_BUFFERS = ['main', 'system', 'crash', 'events', 'radio', 'all'] as const;
export type LogcatBuffer = (typeof LOGCAT_BUFFERS)[number];

export const LOGCAT_LEVELS = ['verbose', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOGCAT_LEVELS)[number];

export interface LogcatOptions {
  serial: string;
  buffers: LogcatBuffer[];
  /** Global minimum level applied client-side; main also receives it for filtering. */
  level: LogLevel;
  /** Optional `TAG:PRIORITY` filter specs forwarded to adb verbatim (validated). */
  filterSpecs: string[];
  /** Optional substring/regex search applied client-side only. */
}

export interface LogcatLine {
  /** Monotonic per-session sequence number. */
  seq: number;
  raw: string;
  /** Parsed threadtime fields (null when the line does not match the format). */
  time: string | null;
  pid: number | null;
  tid: number | null;
  level: string | null;
  tag: string | null;
  message: string | null;
}

export interface LogcatStartResult {
  sessionId: string;
}

export const LOGCAT_EXPORT_FORMATS = ['log', 'json', 'csv'] as const;
export type LogcatExportFormat = (typeof LOGCAT_EXPORT_FORMATS)[number];

export interface LogcatExportResult {
  path: string;
  count: number;
}

export interface LogcatSessionInfo {
  sessionId: string;
  serial: string;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface PairResult {
  /** Human readable summary, e.g. "Connected to 192.168.1.5:5555". */
  message: string;
  /** Raw adb output (truncated). */
  output: string;
  paired: boolean;
}

export interface WirelessEndpoint {
  host: string;
  port: number;
}

// ---------------------------------------------------------------------------
// Flutter / VS Code / scrcpy
// ---------------------------------------------------------------------------

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export interface FlutterDevicesResult {
  raw: string;
  devices: { id: string; name: string; targetType: string }[];
}

export interface ScrcpyOptions {
  serial: string;
  maxFps?: number;
  /** Video bitrate in Mbps (1–100). */
  bitrateMbps?: number;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  noAudio?: boolean;
  windowTitle?: string;
}

export interface ScrcpyStartResult {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Emulator
// ---------------------------------------------------------------------------

/** AVD names (`emulator -list-avds`) available to boot. */
export interface EmulatorListResult {
  avds: string[];
}

export interface EmulatorStartResult {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Tool installation
// ---------------------------------------------------------------------------

/**
 * Progress of an automatic tool install (`tools:install` invoke,
 * `tools:install-progress` event). Zip tools report real download percent;
 * winget installs stay in `installing` until they finish.
 */
export interface InstallProgress {
  tool: ToolName;
  phase: 'downloading' | 'extracting' | 'verifying' | 'installing' | 'done' | 'error';
  /** 0–100; meaningful for `downloading`, 0 for the other phases. */
  percent: number;
  /** Human-readable detail (winget output tail, error message). */
  message?: string;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * Auto-update lifecycle reported on the `update:status` event channel.
 * `downloaded` means the new version is fully on disk and ready to install.
 */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

// ---------------------------------------------------------------------------
// IPC maps
// ---------------------------------------------------------------------------

export interface IpcInvokeMap {
  'system:status': { args: null; result: SystemStatus };
  'system:open-external': { args: { url: string }; result: null };
  'adb:restart-server': { args: null; result: DeviceListResult };
  'devices:list': { args: null; result: DeviceListResult };
  'devices:details': { args: { serial: string }; result: DeviceDetails };
  'devices:diagnostics': { args: { serial: string }; result: DiagnosticReport };
  'devices:reboot': { args: { serial: string }; result: null };
  'devices:disconnect': { args: { serial: string }; result: null };
  'pairing:pair': { args: { host: string; port: number; code: string }; result: PairResult };
  'pairing:connect': { args: { host: string; port: number }; result: PairResult };
  'pairing:disconnect': { args: { host: string; port: number }; result: PairResult };
  'logcat:start': { args: LogcatOptions; result: LogcatStartResult };
  'logcat:stop': { args: { sessionId: string }; result: null };
  'logcat:clear': { args: { serial: string }; result: null };
  'logcat:sessions': { args: null; result: { sessions: LogcatSessionInfo[] } };
  'logcat:export': { args: { format: LogcatExportFormat; lines: LogcatLine[] }; result: LogcatExportResult };
  'flutter:doctor': { args: null; result: CommandResult };
  'flutter:devices': { args: null; result: FlutterDevicesResult };
  'flutter:pub-get': { args: { projectPath: string }; result: CommandResult };
  'vscode:open-folder': { args: { path: string }; result: null };
  'dialogs:pick-folder': { args: { title: string }; result: string | null };
  'scrcpy:start': { args: ScrcpyOptions; result: ScrcpyStartResult };
  'scrcpy:stop': { args: { sessionId: string }; result: null };
  'emulator:list': { args: null; result: EmulatorListResult };
  'emulator:start': { args: { avd: string }; result: EmulatorStartResult };
  'tools:install': { args: { tool: ToolName }; result: null };
  'update:install': { args: null; result: null };
}

export interface IpcEventMap {
  'logcat:lines': { sessionId: string; lines: LogcatLine[] };
  'logcat:exit': { sessionId: string; code: number | null; error?: string };
  'scrcpy:exit': { sessionId: string; code: number | null; error?: string };
  'emulator:exit': { sessionId: string; avd: string; code: number | null; error?: string };
  'tools:install-progress': InstallProgress;
  'update:status': UpdateStatus;
}

export type InvokeChannel = keyof IpcInvokeMap;
export type EventChannel = keyof IpcEventMap;
