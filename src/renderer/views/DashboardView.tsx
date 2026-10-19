import { useMemo } from 'react';
import type { SystemStatus, ToolInfo } from '../../shared/types';
import type { DevicesApi } from '../hooks/useDevices';
import type { useSystemStatus } from '../hooks/useSystemStatus';
import { Card, EmptyState, StatusPill } from '../components/ui';
import { IconDevice, IconExternal, IconShield } from '../components/icons';
import { deviceStateMeta, transportLabel } from '../lib/format';
import type { ViewId } from '../components/Sidebar';
import { call } from '../lib/api';

interface Props {
  devices: DevicesApi;
  system: ReturnType<typeof useSystemStatus>;
  onSelectDevice: (serial: string) => void;
  onNavigate: (view: ViewId) => void;
}

function ToolRow({ info }: { info: ToolInfo }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink capitalize">{info.tool === 'code' ? 'VS Code' : info.tool}</p>
        <p className="truncate font-mono text-[11px] text-muted" title={info.path ?? undefined}>
          {info.available ? (info.version ?? info.path) : (info.hint ?? 'Not installed')}
        </p>
      </div>
      <StatusPill tone={info.available ? 'ok' : 'warn'} label={info.available ? 'Ready' : 'Missing'} />
    </div>
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
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Connected devices"
          description={`${connected.length} online · ${needsAttention.length} need attention`}
          actions={
            <button
              type="button"
              onClick={() => onNavigate('devices')}
              className="text-xs text-cyan-300 hover:text-cyan-200"
            >
              Open devices →
            </button>
          }
        >
          {devices.devices.length === 0 ? (
            <EmptyState
              icon={<IconDevice size={28} />}
              title={devices.error ? 'ADB is unavailable' : 'No devices detected'}
              hint={
                devices.error?.message ??
                'Connect a phone over USB (with USB debugging enabled) or pair a wireless device to get started.'
              }
            />
          ) : (
            <ul className="divide-y divide-line/70">
              {devices.devices.slice(0, 6).map((device) => {
                const meta = deviceStateMeta(device.state);
                return (
                  <li key={device.serial}>
                    <button
                      type="button"
                      onClick={() => onSelectDevice(device.serial)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-ink">{device.model ?? device.serial}</p>
                        <p className="truncate font-mono text-[11px] text-muted">{device.serial}</p>
                      </div>
                      <span className={`shrink-0 text-xs ${meta.text}`}>
                        {meta.label} · {transportLabel(device.transport)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Toolchain" description="Real binaries found on this machine">
          {status ? (
            <div className="divide-y divide-line/70">
              <ToolRow info={status.adb} />
              <ToolRow info={status.flutter} />
              <ToolRow info={status.scrcpy} />
              <ToolRow info={status.vscode} />
            </div>
          ) : (
            <p className="text-sm text-muted">{system.loading ? 'Probing…' : (system.error ?? 'Unavailable')}</p>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Quick actions">
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('pairing')}
                className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
              >
                Pair a device <span className="ml-1 text-xs text-muted">USB or wireless debugging</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('logcat')}
                className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
              >
                Watch logcat <span className="ml-1 text-xs text-muted">Live streaming logs</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tools')}
                className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
              >
                Flutter &amp; VS Code <span className="ml-1 text-xs text-muted">Doctor, devices, projects</span>
              </button>
            </div>
          </Card>

          <Card title="ADB server" description="Restart clears stale device state">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">adb start-server / kill-server</p>
              <button
                type="button"
                onClick={() => {
                  void call('adb:restart-server', null).then(() => devices.refresh());
                }}
                className="rounded-md border border-line bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
              >
                Restart server
              </button>
            </div>
          </Card>
        </div>
      </div>

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
                <li key={device.serial} className="flex items-start justify-between gap-4 rounded-lg border border-line/70 bg-panel-2/50 px-4 py-3">
                  <div>
                    <p className="font-mono text-sm text-ink">{device.serial}</p>
                    <p className="mt-0.5 text-xs text-muted">{hint}</p>
                  </div>
                  <span className={`shrink-0 text-xs ${meta.text}`}>{meta.label}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Safety model" description="How DroidBridge handles your machine and devices">
        <div className="grid gap-4 text-xs leading-relaxed text-muted md:grid-cols-3">
          <div className="flex gap-3">
            <IconShield className="mt-0.5 shrink-0 text-cyan-300" />
            <p>
              Every command runs through <span className="text-slate-300">spawn without a shell</span> — arguments can
              never be interpreted as shell syntax.
            </p>
          </div>
          <div className="flex gap-3">
            <IconDevice className="mt-0.5 shrink-0 text-cyan-300" />
            <p>
              Authorization is <span className="text-slate-300">never bypassed</span>: unauthorized devices show guided
              steps instead of hacks.
            </p>
          </div>
          <div className="flex gap-3">
            <IconExternal className="mt-0.5 shrink-0 text-cyan-300" />
            <p>
              Projects are opened, <span className="text-slate-300">never modified</span> — DroidBridge writes only the
              log files you export.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
