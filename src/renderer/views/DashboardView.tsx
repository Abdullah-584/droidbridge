import { useMemo } from 'react';
import type { SystemStatus, ToolInfo } from '../../shared/types';
import type { DevicesApi } from '../hooks/useDevices';
import type { useSystemStatus } from '../hooks/useSystemStatus';
import { Button, Card, EmptyState, StatusPill } from '../components/ui';
import { EmulatorLauncher } from '../components/EmulatorLauncher';
import { InstallButton } from '../components/InstallButton';
import {
  IconArrowRight,
  IconDevice,
  IconExternal,
  IconShield,
  IconUsb,
  IconWifi,
  IconEmulator,
} from '../components/icons';
import { deviceStateMeta, transportLabel } from '../lib/format';
import type { ViewId } from '../components/Sidebar';
import { call } from '../lib/api';

interface Props {
  devices: DevicesApi;
  system: ReturnType<typeof useSystemStatus>;
  onSelectDevice: (serial: string) => void;
  onNavigate: (view: ViewId) => void;
}

function TransportGlyph({ transport }: { transport: string }) {
  const cls = 'text-dim';
  if (transport === 'usb') return <IconUsb size={12} className={cls} />;
  if (transport === 'tcp') return <IconWifi size={12} className={cls} />;
  if (transport === 'emulator') return <IconEmulator size={12} className={cls} />;
  return null;
}

function ToolRow({ info, onInstalled }: { info: ToolInfo; onInstalled: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink capitalize">
          {info.tool === 'code' ? 'VS Code' : info.tool}
        </p>
        <p className="truncate font-mono text-[10.5px] text-muted" title={info.path ?? undefined}>
          {info.available ? (info.version ?? info.path) : (info.hint ?? 'Not installed')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <StatusPill tone={info.available ? 'ok' : 'warn'} label={info.available ? 'Ready' : 'Missing'} />
        {!info.available && <InstallButton tool={info.tool} onInstalled={onInstalled} />}
      </div>
    </div>
  );
}

function QuickAction({ title, hint, onClick }: { title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 rounded-[9px] border border-line bg-surface-2/60 px-3.5 py-2.5 text-left transition-[background-color,border-color] duration-[var(--t-1)] ease-[var(--ease)] hover:border-line-strong hover:bg-surface-3"
    >
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{title}</p>
        <p className="truncate text-[11px] text-muted">{hint}</p>
      </div>
      <IconArrowRight
        size={13}
        className="shrink-0 text-dim transition-transform duration-[var(--t-1)] ease-[var(--ease)] group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </button>
  );
}

/** Dashboard: connection overview, toolchain health and quick actions. */
export function DashboardView({ devices, system, onSelectDevice, onNavigate }: Props) {
  const status: SystemStatus | null = system.status;
  const connected = useMemo(() => devices.devices.filter((d) => d.state === 'device'), [devices.devices]);
  const needsAttention = useMemo(
    () => devices.devices.filter((d) => d.state !== 'device'),
    [devices.devices],
  );

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card
            title="Connected devices"
            description={`${connected.length} online · ${needsAttention.length} need attention`}
            actions={
              <button
                type="button"
                onClick={() => onNavigate('devices')}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent transition-colors duration-[var(--t-1)] hover:brightness-125"
              >
                Open devices
                <IconArrowRight size={12} />
              </button>
            }
          >
            {devices.devices.length === 0 ? (
              <EmptyState
                icon={<IconDevice size={18} />}
                title={devices.error ? 'ADB is unavailable' : 'No devices detected'}
                hint={
                  devices.error?.message ??
                  'Connect a phone over USB (with USB debugging enabled) or pair a wireless device to get started.'
                }
              />
            ) : (
              <ul className="-mx-2 divide-y divide-line/60">
                {devices.devices.slice(0, 6).map((device) => {
                  const meta = deviceStateMeta(device.state);
                  return (
                    <li key={device.serial}>
                      <button
                        type="button"
                        onClick={() => onSelectDevice(device.serial)}
                        className="flex w-full items-center justify-between gap-3 rounded-[9px] px-2 py-2 text-left transition-colors duration-[var(--t-1)] hover:bg-white/[0.035]"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} aria-label={meta.label} />
                          <div className="min-w-0">
                            <p className="truncate text-[12.5px] font-medium text-ink">
                              {device.model ?? device.serial}
                            </p>
                            <p className="truncate font-mono text-[10.5px] text-muted">{device.serial}</p>
                          </div>
                        </div>
                        <span className={`flex shrink-0 items-center gap-1.5 text-[11px] ${meta.text}`}>
                          <TransportGlyph transport={device.transport} />
                          {meta.label} · {transportLabel(device.transport)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {needsAttention.length > 0 && (
            <Card title="Needs attention" description="Fix these to use the device">
              <ul className="space-y-2">
                {needsAttention.map((device) => {
                  const meta = deviceStateMeta(device.state);
                  const hint =
                    device.state === 'unauthorized'
                      ? 'Unlock the phone and accept the "Allow USB debugging?" prompt — DroidBridge never bypasses it.'
                      : device.state === 'offline'
                        ? 'Device is offline. Reconnect the cable/network or restart the ADB server.'
                        : device.state === 'no-permissions'
                          ? 'The OS blocked adb access. Check the cable/port and try a different USB port.'
                          : `Unexpected state: ${device.state}`;
                  return (
                    <li
                      key={device.serial}
                      className="flex items-start justify-between gap-4 rounded-[9px] border border-l-2 border-warn/25 border-l-warn/60 bg-warn/[0.05] px-4 py-3"
                    >
                      <div>
                        <p className="font-mono text-[12px] text-ink">{device.serial}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] ${meta.text}`}>{meta.label}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card title="Safety model" description="How DroidBridge handles your machine and devices">
            <div className="grid gap-4 text-[11.5px] leading-relaxed text-muted md:grid-cols-3">
              <div className="flex gap-2.5">
                <IconShield className="mt-0.5 shrink-0 text-accent" size={14} />
                <p>
                  Every command runs through <span className="text-ink-2">spawn without a shell</span> — arguments
                  can never be interpreted as shell syntax.
                </p>
              </div>
              <div className="flex gap-2.5">
                <IconDevice className="mt-0.5 shrink-0 text-accent" size={14} />
                <p>
                  Authorization is <span className="text-ink-2">never bypassed</span>: unauthorized devices show
                  guided steps instead of hacks.
                </p>
              </div>
              <div className="flex gap-2.5">
                <IconExternal className="mt-0.5 shrink-0 text-accent" size={14} />
                <p>
                  Projects are opened, <span className="text-ink-2">never modified</span> — DroidBridge writes only
                  the log files you export.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Toolchain" description="Real binaries found on this machine">
            {status ? (
              <div className="divide-y divide-line/60">
                <ToolRow info={status.adb} onInstalled={() => void system.refresh()} />
                <ToolRow info={status.flutter} onInstalled={() => void system.refresh()} />
                <ToolRow info={status.scrcpy} onInstalled={() => void system.refresh()} />
                <ToolRow info={status.vscode} onInstalled={() => void system.refresh()} />
              </div>
            ) : (
              <p className="text-[12.5px] text-muted">{system.loading ? 'Probing…' : (system.error ?? 'Unavailable')}</p>
            )}
          </Card>

          <Card title="Quick actions">
            <div className="space-y-2">
              <QuickAction
                title="Pair a device"
                hint="USB or wireless debugging"
                onClick={() => onNavigate('pairing')}
              />
              <QuickAction title="Watch logcat" hint="Live streaming logs" onClick={() => onNavigate('logcat')} />
              <QuickAction
                title="Flutter & VS Code"
                hint="Doctor, devices, projects"
                onClick={() => onNavigate('tools')}
              />
            </div>
          </Card>

          <Card title="Emulator" description="Boot an Android Virtual Device — it connects over ADB automatically">
            <EmulatorLauncher />
          </Card>

          <Card title="ADB server" description="Restart clears stale device state">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] text-muted">adb start-server / kill-server</p>
              <Button
                size="sm"
                onClick={() => {
                  void call('adb:restart-server', null).then(() => devices.refresh());
                }}
              >
                Restart server
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
