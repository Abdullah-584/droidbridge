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

  const refreshAll = () => {
    void devices.refresh();
    void system.refresh();
  };

  return (
    <div className="ambient flex h-full gap-3 p-3">
      <Sidebar active={view} deviceCount={connected.length} onSelect={setView} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-[var(--shadow-2)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
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
              <span className="truncate font-mono text-[10.5px] text-dim" title={devices.adb.version}>
                {devices.adb.version}
              </span>
            )}
            {system.status && (
              <span className="font-mono text-[10.5px] text-dim">v{system.status.appVersion}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {devices.lastUpdated && (
              <span className="hidden font-mono text-[10.5px] text-dim sm:inline">
                updated {new Date(devices.lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] font-medium text-muted transition-colors duration-[var(--t-1)] hover:bg-surface-3 hover:text-ink"
            >
              <IconRefresh size={13} />
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

        <main key={view} className="enter min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
