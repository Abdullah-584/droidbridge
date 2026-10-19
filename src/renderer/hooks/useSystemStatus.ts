import { useCallback, useEffect, useState } from 'react';
import type { SystemStatus } from '../../shared/types';
import { call } from '../lib/api';

/** Loads system/tool status once and refreshes on demand. */
export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await call('system:status', null);
      setStatus(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, error, loading, refresh };
}
