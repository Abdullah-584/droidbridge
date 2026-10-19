import type { IpcInvokeMap, Result } from '../../shared/types';
import { toAppError } from '../errors';

export interface ChannelSpec<K extends keyof IpcInvokeMap> {
  /** Validates and normalizes the raw invoke payload. Throws ValidationError. */
  validate: (raw: unknown) => IpcInvokeMap[K]['args'];
  handle: (args: IpcInvokeMap[K]['args']) => Promise<IpcInvokeMap[K]['result']> | IpcInvokeMap[K]['result'];
}

export type HandlerSpecs = { [K in keyof IpcInvokeMap]: ChannelSpec<K> };

/** Minimal shape of Electron's ipcMain — lets tests drive the registry. */
export interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Executes one channel: validate → handle → Result envelope (never throws). */
export async function executeChannel<K extends keyof IpcInvokeMap>(
  spec: ChannelSpec<K>,
  rawArgs: unknown,
): Promise<Result<IpcInvokeMap[K]['result']>> {
  try {
    const args = spec.validate(rawArgs);
    const value = await spec.handle(args);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

/** Registers a complete handler map on an ipcMain-like object. */
export function registerInvokeHandlers(ipc: IpcLike, specs: HandlerSpecs): void {
  for (const channel of Object.keys(specs) as (keyof IpcInvokeMap)[]) {
    const spec = specs[channel] as ChannelSpec<typeof channel>;
    ipc.handle(channel, (_event, ...args) => executeChannel(spec, args[0]));
  }
}
