import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';
import { call, subscribe } from '../lib/api';

export interface UpdateApi {
  /** Latest streamed status, or null before the first event / after dismissal. */
  status: UpdateStatus | null;
  /** Human readable failure from a failed restart attempt (cleared on retry). */
  installError: string | null;
  /** Quits into the installer for a fully downloaded update. Never throws. */
  install: () => Promise<void>;
  /** Hides the banner until the next status arrives (update still installs on quit). */
  dismiss: () => void;
}

/** Subscribes to the main process update stream and drives the banner UI. */
export function useUpdate(): UpdateApi {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribe('update:status', (payload) => {
        // Fresh information re-opens the banner even after a dismissal.
        setStatus(payload);
        setDismissed(false);
        setInstallError(null);
      }),
    [],
  );

  const install = useCallback(async () => {
    setInstallError(null);
    try {
      await call('update:install', null);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { status: dismissed ? null : status, installError, install, dismiss };
}
