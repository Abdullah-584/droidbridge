/**
 * IPC channel names. The preload bridge only ever exposes the channels listed
 * here and the main process only registers handlers for them — unknown channels
 * are rejected before touching any logic.
 */

export const INVOKE_CHANNELS = [
  'system:status',
  'system:open-external',
  'adb:restart-server',
  'devices:list',
  'devices:details',
  'devices:diagnostics',
  'devices:reboot',
  'devices:disconnect',
  'pairing:pair',
  'pairing:connect',
  'pairing:disconnect',
  'logcat:start',
  'logcat:stop',
  'logcat:clear',
  'logcat:sessions',
  'logcat:export',
  'flutter:doctor',
  'flutter:devices',
  'flutter:pub-get',
  'vscode:open-folder',
  'dialogs:pick-folder',
  'scrcpy:start',
  'scrcpy:stop',
  'update:install',
] as const;

export const EVENT_CHANNELS = ['logcat:lines', 'logcat:exit', 'scrcpy:exit', 'update:status'] as const;

/** Prefix used by the preload bridge for its typed API namespace. */
export const PRELOAD_BRIDGE_NAME = 'droidbridge';
