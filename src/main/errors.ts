import type { AppError } from '../shared/types';
import { ValidationError } from '../shared/validation';

/** Error type thrown by main-process services; carries a machine readable code. */
export class DroidBridgeError extends Error implements AppError {
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Normalizes any thrown value into the shared AppError shape. */
export function toAppError(e: unknown): AppError {
  if (e instanceof ValidationError) {
    return { code: e.code, message: e.message };
  }
  if (e instanceof DroidBridgeError) {
    return { code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof Error) {
    return { code: 'INTERNAL', message: e.message };
  }
  return { code: 'INTERNAL', message: String(e) };
}
