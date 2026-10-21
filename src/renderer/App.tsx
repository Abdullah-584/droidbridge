import { useEffect, useMemo, useState } from 'react';
import { Sidebar, type ViewId } from './components/Sidebar';
import { StatusPill } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import { IconRefresh } from './components/icons';
import { useDevices } from './hooks/useDevices';
import { useSystemStatus } from './hooks/useSystemStatus';
import { useUpdate } from './hooks/useUpdate';
import { DashboardView } from './views/DashboardView';
import { DevicesView } from './views/DevicesView';
import { LogcatView } from './views/LogcatView';
import { PairingView } from './views/PairingView';
import { ToolsView } from './views/ToolsView';

export default function App() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const devices = useDevices();
  const system = useSystemStatus();
  const update = useUpdate();

  const connected = useMemo(
    () => devices.devices.filter((d) => d.state === 'device'),
    [devices.devices],
  );

  // Keep a valid selection: fall back to the first connected device.
  useEffect(() => {
    if (devices.devices.length === 0) {
      setSelectedSerial(null);
      return;
    }
    const stillThere = selectedSerial && devices.devices.some((d) => d.serial === selectedSerial);
    if (!stillThere) setSelectedSerial(connected[0]?.serial ?? devices.devices[0].serial);
  }, [devices.devices, connected, selectedSerial]);

  const adbTone = !devices.adb
    ? 'idle'
    : devices.error
      ? 'error'
      : connected.length > 0
        ? 'ok'
        : 'idle';

  return (
    <div className="flex h-full">
      <Sidebar active={view} deviceCount={connected.length} onSelect={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-panel/40 px-6 py-3">
          <div className="flex items-center gap-3">
            <StatusPill
              tone={adbTone}
              pulse={connected.length > 0}
              label={
                devices.loading
                  ? 'Detecting devices…'
                  : devices.error
                    ? 'ADB problem'
                    : `${connected.length} connected`
              }
            />
            {devices.adb?.version && (
              <span className="font-mono text-[11px] text-muted">{devices.adb.version}</span>
            )}
            {system.status && (
              <span className="text-[11px] text-muted">v{system.status.appVersion}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {devices.lastUpdated && (
              <span className="text-[11px] text-muted">
                updated {new Date(devices.lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                void devices.refresh();
                void system.refresh();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconRefresh size={14} />
              Refresh
            </button>
          </div>
        </header>

        <UpdateBanner
          status={update.status}
          installError={update.installError}
          onInstall={() => void update.install()}
          onDismiss={update.dismiss}
        />

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {view === 'dashboard' && (
            <DashboardView
              devices={devices}
              system={system}
              onSelectDevice={(serial) => {
                setSelectedSerial(serial);
                setView('devices');
              }}
              onNavigate={setView}
            />
          )}
          {view === 'devices' && (
            <DevicesView
              devices={devices}
              selectedSerial={selectedSerial}
              onSelect={setSelectedSerial}
              onOpenLogcat={(serial) => {
                setSelectedSerial(serial);
                setView('logcat');
              }}
            />
          )}
          {view === 'logcat' && (
            <LogcatView devices={devices.devices} initialSerial={selectedSerial} />
          )}
          {view === 'pairing' && <PairingView devices={devices} />}
          {view === 'tools' && <ToolsView system={system} devices={devices.devices} />}
        </main>
      </div>
    </div>
  );
}
