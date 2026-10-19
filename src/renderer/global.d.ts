import type { IpcEventMap, IpcInvokeMap, Result } from '../shared/types';

export {};

declare global {
  interface Window {
    droidbridge: {
      invoke<K extends keyof IpcInvokeMap>(
        channel: K,
        args: IpcInvokeMap[K]['args'],
      ): Promise<Result<IpcInvokeMap[K]['result']>>;
      on<E extends keyof IpcEventMap>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void;
    };
  }
}
