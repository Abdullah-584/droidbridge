import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceDetails, DiagnosticReport } from '../../shared/types';
import type { DevicesApi } from '../hooks/useDevices';
import { Button, Card, EmptyState, StatusPill } from '../components/ui';
import { IconCopy, IconDevice, IconTerminal } from '../components/icons';
import { batteryTone, deviceStateMeta, diagnosticStyle, transportLabel } from '../lib/format';
import { ApiError, call } from '../lib/api';

interface Props {
  devices: DevicesApi;
  selectedSerial: string | null;
  onSelect: (serial: string) => void;
  onOpenLogcat: (serial: string) => void;
}

function Row({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className={`truncate text-right text-xs text-ink ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

/** Device list + inspector with real details and diagnostics. */
export function DevicesView({ devices, selectedSerial, onSelect, onOpenLogcat }: Props) {
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [busy, setBusy] = useState<'details' | 'diagnostics' | 'action' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestSeq = useRef(0);

  const selected = devices.devices.find((d) => d.serial === selectedSerial) ?? null;

  const loadDetails = useCallback(async (serial: string) => {
    const seq = ++requestSeq.current;
    setBusy('details');
    try {
      const result = await call('devices:details', { serial });
      if (seq === requestSeq.current) setDetails(result);
    } catch (e) {
      if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeq.current) setBusy(null);
    }
  }, []);

  const runDiagnostics = useCallback(async (serial: string) => {
    const seq = ++requestSeq.current;
    setBusy('diagnostics');
    try {
      const report = await call('devices:diagnostics', { serial });
      if (seq === requestSeq.current) setDiagnostics(report);
    } catch (e) {
      if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeq.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    setDetails(null);
    setDiagnostics(null);
    setError(null);
    if (selectedSerial && selected?.state === 'device') {
      void loadDetails(selectedSerial);
    }
  }, [selectedSerial, selected?.state, loadDetails]);

  const act = async (fn: () => Promise<unknown>, confirmMessage?: string) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy('action');
    setError(null);
    try {
      await fn();
      if (selectedSerial) await devices.refresh();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (devices.devices.length === 0) {
    return (
      <EmptyState
        icon={<IconDevice size={30} />}
        title={devices.error ? 'ADB unavailable' : 'No devices yet'}
        hint={devices.error?.message ?? 'Connect a device over USB or pair one wirelessly, then it will appear here automatically.'}
      />
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Devices" description={`${devices.devices.length} listed by adb`} bodyClassName="p-2">
        <ul className="space-y-1">
          {devices.devices.map((device) => {
            const meta = deviceStateMeta(device.state);
            const active = device.serial === selectedSerial;
            return (
              <li key={device.serial}>
                <button
                  type="button"
                  onClick={() => onSelect(device.serial)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{device.model ?? device.serial}</p>
                    <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} aria-label={meta.label} />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{device.serial}</p>
                  <p className={`mt-1 text-[11px] ${meta.text}`}>
                    {meta.label} · {transportLabel(device.transport)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="min-w-0 space-y-5">
        {!selected ? (
          <EmptyState title="Select a device" hint="Pick a device on the left to inspect it." />
        ) : (
          <>
            <Card
              title={selected.model ?? selected.serial}
              description={`${selected.serial} · ${transportLabel(selected.transport)}`}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusPill
                    tone={selected.state === 'device' ? 'ok' : selected.state === 'unauthorized' ? 'warn' : 'error'}
                    label={deviceStateMeta(selected.state).label}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(selected.serial).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      });
                    }}
                  >
                    <IconCopy size={13} />
                    {copied ? 'Copied' : 'Copy serial'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={selected.state !== 'device'}
                    onClick={() => onOpenLogcat(selected.serial)}
                    title="Open the Logcat view for this device"
                  >
                    <IconTerminal size={13} />
                    Logcat
                  </Button>
                  {selected.transport === 'tcp' && (
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === 'action'}
                      onClick={() =>
                        void act(
                          () => call('devices:disconnect', { serial: selected.serial }),
                          `Disconnect wireless device ${selected.serial}?`,
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === 'action'}
                    onClick={() =>
                      void act(
                        () => call('devices:reboot', { serial: selected.serial }),
                        `Reboot ${selected.model ?? selected.serial}? The device will restart.`,
                      )
                    }
                  >
                    Reboot
                  </Button>
                </div>
              }
            >
              {selected.state === 'unauthorized' && (
                <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
                  This device is <strong>unauthorized</strong>. Unlock the screen and accept the
                  “Allow USB debugging?” RSA prompt on the device. DroidBridge will never bypass this
                  security check — if the prompt is missing, unplug/replug the cable to re-trigger it.
                </div>
              )}
              {error && (
                <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                  {error}
                </div>
              )}

              <div className="grid gap-x-8 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Identity</h3>
                  <Row label="Brand" value={details?.brand} />
                  <Row label="Manufacturer" value={details?.manufacturer} />
                  <Row label="Model" value={details?.model} mono />
                  <Row label="Android" value={details?.androidVersion ? `${details.androidVersion} (API ${details.sdk})` : null} />
                  <Row label="ABI" value={details?.abi} mono />
                  <Row label="Fingerprint" value={details?.buildFingerprint} mono />
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Live state</h3>
                  {details?.battery ? (
                    <div className="py-1.5">
                      <span className="text-xs text-muted">Battery </span>
                      <span className={`text-xs font-semibold ${batteryTone(details.battery.level)}`}>
                        {details.battery.level}%
                      </span>
                      <span className="text-xs text-muted">
                        {' '}
                        · {details.battery.status}
                        {details.battery.temperatureC !== undefined && ` · ${details.battery.temperatureC.toFixed(1)} °C`}
                        {details.battery.plugged && ` · ${details.battery.plugged}`}
                      </span>
                    </div>
                  ) : (
                    <Row label="Battery" value={busy === 'details' ? 'Loading…' : null} />
                  )}
                  <Row label="Display" value={details ? `${details.display.size ?? '?'} @ ${details.display.density ?? '?'} dpi` : null} />
                  <Row label="IP addresses" value={details && details.ipAddresses.length > 0 ? details.ipAddresses.join(', ') : null} mono />
                  <Row label="Memory" value={details?.memory.totalKb ? `${(details.memory.totalKb / 1024 / 1024).toFixed(1)} GB total` : null} />
                  <Row label="SELinux" value={details?.selinux} />
                  <Row label="Storage (/data)" value={details?.storage.find((s) => s.path === '/data') ? `${details.storage.find((s) => s.path === '/data')!.used} used` : null} />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                <Button size="sm" onClick={() => selectedSerial && void loadDetails(selectedSerial)} loading={busy === 'details'}>
                  Refresh details
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={selected.state !== 'device'}
                  loading={busy === 'diagnostics'}
                  onClick={() => selectedSerial && void runDiagnostics(selectedSerial)}
                >
                  Run diagnostics
                </Button>
                <span className="text-[11px] text-muted">
                  {diagnostics
                    ? `${diagnostics.checks.length} checks · ${new Date(diagnostics.collectedAt).toLocaleTimeString()}`
                    : 'Runs real adb commands against this device'}
                </span>
              </div>
            </Card>

            {diagnostics && (
              <Card title="Diagnostics" description={`Collected ${new Date(diagnostics.collectedAt).toLocaleString()}`}>
                <ul className="space-y-2">
                  {diagnostics.checks.map((check) => (
                    <li
                      key={check.id}
                      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-lg border border-line/60 bg-panel-2/40 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{check.label}</p>
                        {check.hint && <p className="mt-0.5 text-xs text-muted">{check.hint}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-xs text-slate-300">{check.value}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${diagnosticStyle(check.status)}`}>
                          {check.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {details && details.warnings.length > 0 && (
              <Card title="Collection warnings">
                <ul className="list-inside list-disc text-xs text-amber-200">
                  {details.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Card>
            )}

            {details && (
              <Card title="Raw properties" description="Selected getprop values (real device data)">
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[11px]">
                    <tbody className="divide-y divide-line/50">
                      {Object.entries(details.props)
                        .filter(([, value]) => value.length > 0)
                        .map(([key, value]) => (
                          <tr key={key}>
                            <td className="whitespace-nowrap py-1.5 pr-6 text-muted">{key}</td>
                            <td className="py-1.5 text-ink">{value}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
