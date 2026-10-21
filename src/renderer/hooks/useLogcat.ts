import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogcatExportFormat, LogcatExportResult, LogcatLine, LogcatOptions } from '../../shared/types';
import { call, subscribe } from '../lib/api';

const MAX_BUFFERED_LINES = 5000;

export interface LogcatState {
  sessionId: string | null;
  running: boolean;
  /** Lines currently shown (unfiltered; filtering is applied in the view). */
  lines: LogcatLine[];
  paused: boolean;
  droppedWhilePaused: number;
  exitInfo: { code: number | null; error?: string } | null;
}

/**
 * Owns one logcat streaming session. Incoming batches are appended to a
 * bounded buffer; while paused, lines still stream in from the main process
 * but the visible snapshot freezes (with a counter of hidden lines).
 */
export function useLogcat() {
  const [state, setState] = useState<LogcatState>({
    sessionId: null,
    running: false,
    lines: [],
    paused: false,
    droppedWhilePaused: 0,
    exitInfo: null,
  });

  const sessionRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const pendingRef = useRef<LogcatLine[]>([]);
  const pausedCountRef = useRef(0);

  useEffect(() => {
    const offLines = subscribe('logcat:lines', ({ sessionId, lines }) => {
      if (sessionId !== sessionRef.current) return;
      if (pausedRef.current) {
        pendingRef.current.push(...lines);
        pausedCountRef.current += lines.length;
        return;
      }
      setState((prev) => {
        const next = [...prev.lines, ...lines];
        const overflow = next.length - MAX_BUFFERED_LINES;
        return { ...prev, lines: overflow > 0 ? next.slice(overflow) : next };
      });
    });

    const offExit = subscribe('logcat:exit', ({ sessionId, code, error }) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setState((prev) => ({ ...prev, running: false, sessionId: null, exitInfo: { code, error } }));
    });

    return () => {
      offLines();
      offExit();
    };
  }, []);

  const start = useCallback(async (options: Omit<LogcatOptions, 'buffers' | 'level' | 'filterSpecs'> & Partial<LogcatOptions>) => {
    const { sessionId } = await call('logcat:start', {
      serial: options.serial,
      buffers: options.buffers ?? ['main'],
      level: options.level ?? 'verbose',
      filterSpecs: options.filterSpecs ?? [],
    });
    sessionRef.current = sessionId;
    pausedRef.current = false;
    pendingRef.current = [];
    pausedCountRef.current = 0;
    setState({
      sessionId,
      running: true,
      lines: [],
      paused: false,
      droppedWhilePaused: 0,
      exitInfo: null,
    });
  }, []);

  const stop = useCallback(async () => {
    const id = sessionRef.current;
    if (!id) return;
    sessionRef.current = null;
    await call('logcat:stop', { sessionId: id }).catch(() => undefined);
    setState((prev) => ({ ...prev, running: false, sessionId: null }));
  }, []);

  const clear = useCallback(() => {
    setState((prev) => ({ ...prev, lines: [] }));
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
    if (!paused) {
      const pending = pendingRef.current;
      const hidden = pausedCountRef.current;
      pendingRef.current = [];
      pausedCountRef.current = 0;
      setState((prev) => {
        const next = [...prev.lines, ...pending];
        const overflow = next.length - MAX_BUFFERED_LINES;
        return {
          ...prev,
          paused,
          droppedWhilePaused: 0,
          lines: overflow > 0 ? next.slice(overflow) : next,
        };
      });
      void hidden;
    } else {
      setState((prev) => ({ ...prev, paused: true }));
    }
  }, []);

  const clearDeviceBuffer = useCallback(async (serial: string) => {
    await call('logcat:clear', { serial });
  }, []);

  const exportLines = useCallback(
    async (lines: LogcatLine[], format: LogcatExportFormat): Promise<LogcatExportResult> =>
      call('logcat:export', { format, lines }),
    [],
  );

  useEffect(() => {
    const id = sessionRef.current;
    return () => {
      if (id) void call('logcat:stop', { sessionId: id }).catch(() => undefined);
    };
  }, []);

  return { ...state, start, stop, clear, setPaused, clearDeviceBuffer, exportLines };
}
