import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdbDevice, AppError, ToolInfo } from '../../shared/types';
import { ApiError, call } from '../lib/api';

export interface DevicesState {
  devices: AdbDevice[];
  adb: ToolInfo | null;
  raw: string;
  error: AppError | null;
  loading: boolean;
  lastUpdated: number | null;
}

const INITIAL: DevicesState = {
  devices: [],
  adb: null,
  raw: '',
  error: null,
  loading: true,
  lastUpdated: null,
};

export interface DevicesApi extends DevicesState {
  refresh: () => Promise<void>;
}

/**
 * Polls real `adb devices -l` data. Polling pauses while the window is hidden
 * and resumes (with an immediate refresh) when it becomes visible again.
 */
export function useDevices(pollMs = 4000): DevicesApi {
  const [state, setState] = useState<DevicesState>(INITIAL);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await call('devices:list', null);
      setState({
        devices: result.devices,
        adb: result.adb,
        raw: result.raw,
        error: result.error ?? null,
        loading: false,
        lastUpdated: Date.now(),
      });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: { code: e instanceof ApiError ? e.code : 'INTERNAL', message: e instanceof Error ? e.message : String(e) },
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const start = () => {
      if (timer.current) return;
      timer.current = setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, pollMs);
    };
    const stop = () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs, refresh]);

  return { ...state, refresh };
}

/** Finds a device by serial in the current list (or null). */
export function findDevice(devices: AdbDevice[], serial: string | null): AdbDevice | null {
  if (!serial) return null;
  return devices.find((d) => d.serial === serial) ?? null;
}
