import { useEffect, useRef, useState } from 'react';
import type { InstallProgress, ToolName } from '../../shared/types';
import { Button } from './ui';
import { call } from '../lib/api';

const DISPLAY: Record<ToolName, string> = {
  adb: 'adb',
  scrcpy: 'scrcpy',
  flutter: 'Flutter',
  code: 'VS Code',
};

export interface InstallButtonProps {
  tool: ToolName;
  /** Overrides the display name in the button text (defaults per tool). */
  label?: string;
  /** Called after the `done` event — refresh toolchain status here. */
  onInstalled?: () => void;
  className?: string;
}

/**
 * One-click automatic installation for a missing tool. Shows live download
 * percent from the main process (`tools:install-progress`), switches back on
 * `done`, and surfaces failures as an alert instead of failing silently —
 * including installs started automatically by the app itself.
 */
export function InstallButton({ tool, label, onInstalled, className = '' }: InstallButtonProps) {
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const onInstalledRef = useRef(onInstalled);

  useEffect(() => {
    onInstalledRef.current = onInstalled;
  }, [onInstalled]);

  useEffect(() => {
    return window.droidbridge.on('tools:install-progress', (payload) => {
      if (payload.tool !== tool) return;
      if (payload.phase === 'done') {
        setProgress(null);
        setError(null);
        onInstalledRef.current?.();
      } else if (payload.phase === 'error') {
        setProgress(null);
        setError(payload.message ?? 'Installation failed.');
      } else {
        setError(null);
        setProgress(payload);
      }
    });
  }, [tool]);

  const install = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      await call('tools:install', { tool });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const busy = pending || progress !== null;
  const text = progress
    ? progress.percent > 0
      ? `Installing… ${progress.percent}%`
      : 'Installing…'
    : `Install ${label ?? DISPLAY[tool]}`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Button variant="primary" size="sm" loading={busy} onClick={() => void install()}>
        {text}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-[11px] leading-snug text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
