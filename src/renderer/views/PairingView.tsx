import { useState } from 'react';
import type { DevicesApi } from '../hooks/useDevices';
import { Button, Card, Field, StatusPill, inputClass } from '../components/ui';
import { IconExternal, IconLink, IconShield } from '../components/icons';
import { deviceStateMeta } from '../lib/format';
import { ApiError, call } from '../lib/api';

const STEPS = [
  {
    title: 'Enable Developer options',
    body: 'On the phone: Settings → About phone → tap “Build number” seven times.',
  },
  {
    title: 'Enable USB debugging',
    body: 'Settings → System → Developer options → enable “USB debugging” (and “Wireless debugging” for Wi-Fi).',
  },
  {
    title: 'Plug in and authorize',
    body: 'Connect via USB and accept the “Allow USB debugging?” RSA prompt on the device. DroidBridge never bypasses this prompt.',
  },
  { title: 'Refresh', body: 'Press “Refresh devices” below — the device appears in the dashboard once authorized.' },
];

interface Props {
  devices: DevicesApi;
}

/** USB + wireless pairing workflows. */
export function PairingView({ devices }: Props) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5555');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'pair' | 'connect' | 'disconnect' | 'refresh' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const wireDevices = devices.devices.filter((d) => d.transport === 'tcp');

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!host.trim()) errors.host = 'Enter the device IP (shown in Developer options → Wireless debugging).';
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) errors.port = 'Port must be 1–65535.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const run = async (
    kind: 'pair' | 'connect' | 'disconnect',
    fn: () => Promise<{ message: string; paired: boolean }>,
  ) => {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await fn();
      setMessage({ tone: result.paired ? 'ok' : 'error', text: result.message });
      await devices.refresh();
    } catch (e) {
      const text = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setMessage({ tone: 'error', text });
    } finally {
      setBusy(null);
    }
  };

  const doPair = () => {
    if (!validate()) return;
    void run('pair', () =>
      call('pairing:pair', { host: host.trim(), port: Number(port), code: code.trim() }),
    );
  };

  const doConnect = () => {
    if (!validate()) return;
    void run('connect', () => call('pairing:connect', { host: host.trim(), port: Number(port) }));
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card
        title="USB workflow"
        description="Wired debugging, the reliable default"
        actions={<StatusPill tone={devices.devices.some((d) => d.transport === 'usb') ? 'ok' : 'idle'} label="USB" />}
      >
        <ol className="space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-[11px] font-bold text-cyan-200">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'refresh'}
            onClick={() => {
              setBusy('refresh');
              void devices.refresh().finally(() => setBusy(null));
            }}
          >
            Refresh devices
          </Button>
          <Button
            size="sm"
            loading={busy === 'refresh'}
            onClick={() => {
              setBusy('refresh');
              void call('adb:restart-server', null)
                .then(() => devices.refresh())
                .finally(() => setBusy(null));
            }}
            title="adb kill-server && adb start-server"
          >
            Restart ADB server
          </Button>
        </div>

        {devices.devices.length > 0 && (
          <ul className="mt-4 divide-y divide-line/60 border-t border-line pt-2">
            {devices.devices.map((device) => {
              const meta = deviceStateMeta(device.state);
              return (
                <li key={device.serial} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate font-mono text-xs text-slate-300">{device.serial}</span>
                  <span className={`shrink-0 text-xs ${meta.text}`}>{meta.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="space-y-5">
        <Card
          title="Wireless pairing"
          description="Android 11+ wireless debugging on the same Wi-Fi network"
          actions={<IconLink className="text-cyan-300" />}
        >
          <div className="mb-4 rounded-lg border border-line/70 bg-panel-2/50 px-4 py-3 text-xs leading-relaxed text-muted">
            On the device: Settings → Developer options → <strong className="text-slate-300">Wireless debugging</strong> →
            “Pair device with pairing code”. Enter the <strong className="text-slate-300">IP:port</strong> and the
            six-digit pairing code shown there below. The device and this PC must be on the same network.
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device IP or hostname" error={fieldErrors.host}>
              <input
                className={inputClass}
                placeholder="192.168.1.42"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Port"
              error={fieldErrors.port}
              hint="The “IP address & port” from wireless debugging (not 5555)."
            >
              <input
                className={inputClass}
                placeholder="42123"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Pairing code" hint="Six digits shown on the device.">
              <input
                className={`${inputClass} font-mono tracking-[0.4em]`}
                placeholder="••••••"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button
                variant="primary"
                loading={busy === 'pair'}
                disabled={code.length !== 6}
                onClick={doPair}
              >
                Pair
              </Button>
              <Button loading={busy === 'connect'} onClick={doConnect} title="adb connect host:port">
                Connect
              </Button>
            </div>
          </div>

          {message && (
            <p
              className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                message.tone === 'ok'
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                  : 'border-rose-400/30 bg-rose-400/10 text-rose-200'
              }`}
            >
              {message.text}
            </p>
          )}
        </Card>

        <Card
          title={`Wireless devices (${wireDevices.length})`}
          description="Connected over TCP — disconnect any time"
        >
          {wireDevices.length === 0 ? (
            <p className="text-xs text-muted">No wireless devices connected right now.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {wireDevices.map((device) => {
                const meta = deviceStateMeta(device.state);
                const [deviceHost, devicePort] = device.serial.split(':');
                return (
                  <li key={device.serial} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-ink">{device.model ?? device.serial}</p>
                      <p className={`text-[11px] ${meta.text}`}>
                        {meta.label} · {device.ip}:{device.port}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === 'disconnect'}
                      onClick={() =>
                        void run('disconnect', () =>
                          call('pairing:disconnect', { host: deviceHost, port: Number(devicePort) }),
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Troubleshooting" actions={<IconShield className="text-cyan-300" />}>
          <ul className="space-y-2.5 text-xs leading-relaxed text-muted">
            <li>
              <button
                type="button"
                className="text-cyan-300 hover:text-cyan-200"
                onClick={() => void call('system:open-external', { url: 'https://developer.android.com/tools/adb' })}
              >
                ADB over Wi-Fi documentation <IconExternal size={11} className="inline" />
              </button>
            </li>
            <li>
              Pairing codes expire in a few seconds — keep the pairing dialog open on the device and retry quickly.
            </li>
            <li>
              “adb connect” uses the <span className="font-mono text-slate-300">Connect to port</span> from wireless
              debugging; “Pair” uses the separate <span className="font-mono text-slate-300">Pair with code</span> port.
            </li>
            <li>If the device shows offline, restart the ADB server (USB tab) and reconnect.</li>
            <li>Some corporate/VPN networks block device-to-PC traffic; use the same plain Wi-Fi network.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
