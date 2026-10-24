import { describe, expect, it } from 'vitest';
import { executeChannel, registerInvokeHandlers, type ChannelSpec, type IpcLike } from '../../src/main/ipc/registry';
import { createHandlerSpecs } from '../../src/main/ipc/handlers';
import { ValidationError } from '../../src/shared/validation';
import { INVOKE_CHANNELS } from '../../src/shared/channels';
import type { LogcatManager } from '../../src/main/adb/logcat';
import type { ScrcpyManager } from '../../src/main/services/scrcpy';
import type { EmulatorManager } from '../../src/main/services/emulator';

describe('executeChannel', () => {
  it('wraps successful handlers in a Result envelope', async () => {
    const spec: ChannelSpec<'devices:list'> = {
      validate: () => null,
      handle: () => ({ devices: [], adb: { tool: 'adb', available: true, path: 'adb', version: null, source: 'path' }, raw: '' }),
    };
    const result = await executeChannel(spec, undefined);
    expect(result.ok).toBe(true);
  });

  it('converts validation failures into structured errors', async () => {
    const spec: ChannelSpec<'devices:details'> = {
      validate: () => {
        throw new ValidationError('Invalid device serial.');
      },
      handle: () => {
        throw new Error('should not run');
      },
    };
    const result = await executeChannel(spec, { serial: 'bad serial!' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid device serial.' },
    });
  });

  it('normalizes unexpected handler failures', async () => {
    const spec: ChannelSpec<'system:status'> = {
      validate: () => null,
      handle: () => {
        throw new Error('boom');
      },
    };
    const result = await executeChannel(spec, undefined);
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
  });
});

describe('registerInvokeHandlers', () => {
  it('registers every channel exactly once and routes validated args', async () => {
    const registered: string[] = [];
    const ipc: IpcLike = {
      handle(channel, listener) {
        registered.push(channel);
        void listener;
      },
    };
    const fakeDeps = {
      logcat: {} as LogcatManager,
      scrcpy: {} as ScrcpyManager,
      emulator: {} as EmulatorManager,
      appVersion: '0.0.0',
      platform: 'win32',
      getWindow: () => undefined,
      openExternal: () => undefined,
      pickFolder: async () => null,
      installUpdate: () => undefined,
      installer: {
        install: async () => undefined,
        autoInstallMissing: async () => undefined,
      },
    };
    registerInvokeHandlers(ipc, createHandlerSpecs(fakeDeps));
    expect(new Set(registered)).toEqual(new Set(INVOKE_CHANNELS));
    expect(registered.length).toBe(INVOKE_CHANNELS.length);
  });
});

describe('createHandlerSpecs validation', () => {
  const fakeDeps = {
    logcat: {} as LogcatManager,
    scrcpy: {} as ScrcpyManager,
    emulator: {} as EmulatorManager,
    appVersion: '0.0.0',
    platform: 'win32',
    getWindow: () => undefined,
    openExternal: () => undefined,
    pickFolder: async () => null,
    installUpdate: () => undefined,
    installer: {
      install: async () => undefined,
      autoInstallMissing: async () => undefined,
    },
  };
  const specs = createHandlerSpecs(fakeDeps);

  it('rejects injection-shaped serials on every device channel', () => {
    const bad = { serial: 'x; del /f /q C:\\' };
    expect(() => specs['devices:details'].validate(bad)).toThrow(ValidationError);
    expect(() => specs['devices:diagnostics'].validate(bad)).toThrow(ValidationError);
    expect(() => specs['devices:reboot'].validate(bad)).toThrow(ValidationError);
    expect(() => specs['devices:disconnect'].validate(bad)).toThrow(ValidationError);
    expect(() => specs['logcat:clear'].validate(bad)).toThrow(ValidationError);
  });

  it('validates pairing payloads end to end', () => {
    expect(specs['pairing:pair'].validate({ host: '192.168.1.7', port: 42123, code: '492831' })).toEqual({
      host: '192.168.1.7',
      port: 42123,
      code: '492831',
    });
    expect(() => specs['pairing:pair'].validate({ host: '192.168.1.7', port: 42123, code: '4928' })).toThrow(
      ValidationError,
    );
    expect(() => specs['pairing:connect'].validate({ host: '$(calc)', port: 5555 })).toThrow(ValidationError);
  });

  it('requires absolute paths for project actions', () => {
    expect(() => specs['flutter:pub-get'].validate({ projectPath: 'relative/dir' })).toThrow(ValidationError);
    expect(() => specs['vscode:open-folder'].validate({ path: 'C:\\dev\u0000evil' })).toThrow(ValidationError);
    expect(specs['flutter:pub-get'].validate({ projectPath: 'C:\\dev\\app' })).toEqual({
      projectPath: 'C:\\dev\\app',
    });
  });

  it('only allows http(s) URLs for external opening', () => {
    expect(() => specs['system:open-external'].validate({ url: 'file:///C:/Windows' })).toThrow(ValidationError);
    expect(specs['system:open-external'].validate({ url: 'https://docs.flutter.dev' })).toEqual({
      url: 'https://docs.flutter.dev/',
    });
  });

  it('accepts null-arg channels without payload', () => {
    expect(specs['system:status'].validate(undefined)).toBeNull();
    expect(specs['devices:list'].validate(null)).toBeNull();
    expect(specs['emulator:list'].validate(null)).toBeNull();
  });

  it('validates emulator start payloads', () => {
    expect(specs['emulator:start'].validate({ avd: 'Pixel_7_API_34' })).toEqual({ avd: 'Pixel_7_API_34' });
    expect(() => specs['emulator:start'].validate({ avd: '../../etc' })).toThrow(ValidationError);
    expect(() => specs['emulator:start'].validate({ avd: '-list-avds' })).toThrow(ValidationError);
    expect(() => specs['emulator:start'].validate({ avd: '' })).toThrow(ValidationError);
    expect(() => specs['emulator:start'].validate({})).toThrow(ValidationError);
    expect(() => specs['emulator:start'].validate({ avd: 42 })).toThrow(ValidationError);
  });

  it('accepts only known tool names for installation', () => {
    expect(specs['tools:install'].validate({ tool: 'scrcpy' })).toEqual({ tool: 'scrcpy' });
    expect(specs['tools:install'].validate({ tool: 'adb' })).toEqual({ tool: 'adb' });
    // Closed enum — never a path, URL fragment or other free-form input.
    expect(() => specs['tools:install'].validate({ tool: 'rm -rf' })).toThrow(ValidationError);
    expect(() => specs['tools:install'].validate({ tool: '../../evil' })).toThrow(ValidationError);
    expect(() => specs['tools:install'].validate({ tool: '' })).toThrow(ValidationError);
    expect(() => specs['tools:install'].validate({ tool: 42 })).toThrow(ValidationError);
    expect(() => specs['tools:install'].validate({})).toThrow(ValidationError);
  });
});
