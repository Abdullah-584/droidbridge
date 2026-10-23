import { useEffect, useRef, useState } from 'react';
import { ApiError, call, subscribe } from '../lib/api';
import { Button } from './ui';

type Phase = 'idle' | 'listing' | 'choosing' | 'starting' | 'error';

/**
 * Dashboard launcher for Android Virtual Devices. Lists the AVDs installed on
 * this machine (`emulator -list-avds`), boots the picked one, and tracks the
 * `emulator:exit` event so a failed boot (e.g. `PANIC: unknown AVD name`) is
 * shown honestly instead of being silently ignored. Once booted, the emulator
 * is a normal ADB device and appears in the dashboard's device list.
 */
export function EmulatorLauncher() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [avds, setAvds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribe('emulator:exit', (payload) => {
      if (payload.sessionId !== sessionRef.current) return; // another session's exit
      sessionRef.current = null;
      setPicked(null);
      if (payload.error || (payload.code !== null && payload.code !== 0)) {
        setMessage(payload.error ?? `The emulator exited with code ${String(payload.code)}.`);
        setPhase('error');
      } else {
        setMessage(null);
        setPhase('idle');
      }
    });
  }, []);

  const startAvd = async (avd: string): Promise<void> => {
    setPicked(avd);
    setMessage(null);
    setPhase('starting');
    try {
      const result = await call('emulator:start', { avd });
      sessionRef.current = result.sessionId;
    } catch (e) {
      sessionRef.current = null;
      setPicked(null);
      setMessage(e instanceof ApiError ? e.message : 'Failed to start the emulator.');
      setPhase('error');
    }
  };

  const launch = async (): Promise<void> => {
    setMessage(null);
    setPhase('listing');
    try {
      const result = await call('emulator:list', null);
      if (result.avds.length === 0) {
        setMessage(
          "No Android virtual devices found. Create one in Android Studio's Device Manager, then try again.",
        );
        setPhase('error');
        return;
      }
      setAvds(result.avds);
      // One AVD: nothing to choose — boot it right away.
      if (result.avds.length === 1) {
        await startAvd(result.avds[0]);
        return;
      }
      setPhase('choosing');
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Failed to list Android virtual devices.');
      setPhase('error');
    }
  };

  return (
    <div className="space-y-3">
      {phase === 'choosing' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Pick a virtual device to boot:</p>
          <div className="flex flex-col gap-2">
            {avds.map((avd) => (
              <button
                key={avd}
                type="button"
                onClick={() => void startAvd(avd)}
                className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-2.5 text-left font-mono text-sm text-slate-200 hover:bg-white/[0.07]"
              >
                {avd}
              </button>
            ))}
          </div>
        </div>
      ) : phase === 'starting' && picked ? (
        <div>
          <p className="font-mono text-sm text-slate-200">Starting {picked}…</p>
          <p className="mt-0.5 text-xs text-muted">Booting can take a minute.</p>
        </div>
      ) : (
        <Button variant="primary" loading={phase === 'listing'} onClick={() => void launch()}>
          Start emulator
        </Button>
      )}

      {message && (
        <p role="alert" className="text-xs leading-relaxed text-rose-300">
          {message}
        </p>
      )}
    </div>
  );
}
