import type { IpcEventMap, IpcInvokeMap } from '../../shared/types';

/** Error thrown when the main process returns a structured failure. */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Typed invoke wrapper: unwraps the Result envelope and throws ApiError so
 * views can render honest error messages.
 */
export async function call<K extends keyof IpcInvokeMap>(
  channel: K,
  args: IpcInvokeMap[K]['args'],
): Promise<IpcInvokeMap[K]['result']> {
  const result = await window.droidbridge.invoke(channel, args);
  if (!result.ok) {
    throw new ApiError(result.error.code, result.error.message);
  }
  return result.value;
}

/** Subscribes to a main-process event; returns an unsubscribe function. */
export function subscribe<E extends keyof IpcEventMap>(
  event: E,
  listener: (payload: IpcEventMap[E]) => void,
): () => void {
  return window.droidbridge.on(event, listener);
}
