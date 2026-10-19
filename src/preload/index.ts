import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, PRELOAD_BRIDGE_NAME } from '../shared/channels';
import type { IpcEventMap, IpcInvokeMap, Result } from '../shared/types';

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

/**
 * Sandboxed preload: exposes a minimal typed bridge. It only forwards the
 * allow-listed channels below — nothing else from ipcRenderer is reachable
 * from the page.
 */
const bridge = {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    args: IpcInvokeMap[K]['args'],
  ): Promise<Result<IpcInvokeMap[K]['result']>> {
    if (!invokeChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` },
      });
    }
    return ipcRenderer.invoke(channel, args) as Promise<Result<IpcInvokeMap[K]['result']>>;
  },
  on<E extends keyof IpcEventMap>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
    if (!eventChannels.has(event)) {
      return () => undefined;
    }
    const wrapped = (_event: unknown, payload: IpcEventMap[E]): void => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld(PRELOAD_BRIDGE_NAME, bridge);
