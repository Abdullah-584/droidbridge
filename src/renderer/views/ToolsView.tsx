import { useState } from 'react';
import type { AdbDevice, CommandResult, SystemStatus } from '../../shared/types';
import type { useSystemStatus } from '../hooks/useSystemStatus';
import { Button, Card, EmptyState, Field, StatusPill, inputClass } from '../components/ui';
import { IconExternal, IconFolder, IconPlay, IconStop } from '../components/icons';
import { call } from '../lib/api';

interface Props {
  system: ReturnType<typeof useSystemStatus>;
  devices: AdbDevice[];
}

function OutputPanel({ result, empty }: { result: CommandResult | null; empty: string }) {
  if (!result) {
    return <p className="text-xs text-muted">{empty}</p>;
  }
  const text = `${result.stdout}${result.stderr}`.trim() || '(no output)';
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={`rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${
            result.code === 0
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-rose-400/30 bg-rose-400/10 text-rose-300'
          }`}
        >
          exit {result.code ?? 'n/a'}
        </span>
        <span className="text-muted">{(result.durationMs / 1000).toFixed(1)}s</span>
        {result.timedOut && <span className="text-amber-300">timed out</span>}
        {result.truncated && <span className="text-amber-300">output truncated</span>}
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg bg-[#080d18] p-4 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-slate-300">
        {text}
      </pre>
    </div>
  );
}

/** Flutter, VS Code and scrcpy integration. */
export function ToolsView({ system, devices }: Props) {
  const status: SystemStatus | null = system.status;
  const [flutterOut, setFlutterOut] = useState<CommandResult | null>(null);
  const [flutterDevices, setFlutterDevices] = useState<{ id: string; name: string; targetType: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [scrcpySession, setScrcpySession] = useState<string | null>(null);
  const [scrcpy, setScrcpy] = useState({ maxFps: 60, bitrateMbps: 8, noAudio: false, fullscreen: false, alwaysOnTop: false });

  const readyDevices = devices.filter((d) => d.state === 'device');
  const [mirrorSerial, setMirrorSerial] = useState<string>('');

  const runTask = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pickFolder = () =>
    runTask('pick', async () => {
      const folder = await call('dialogs:pick-folder', { title: 'Select a Flutter project folder' });
      if (folder) setProjectPath(folder);
    });

  const startMirror = () =>
    runTask('scrcpy-start', async () => {
      const { sessionId } = await call('scrcpy:start', {
        serial: mirrorSerial,
        maxFps: scrcpy.maxFps,
        bitrateMbps: scrcpy.bitrateMbps,
        noAudio: scrcpy.noAudio,
        fullscreen: scrcpy.fullscreen,
        alwaysOnTop: scrcpy.alwaysOnTop,
      });
      setScrcpySession(sessionId);
      setNotice('scrcpy window launched.');
    });

  const stopMirror = () =>
    runTask('scrcpy-stop', async () => {
      if (scrcpySession) await call('scrcpy:stop', { sessionId: scrcpySession });
      setScrcpySession(null);
    });

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card
        title="Flutter"
        description="SDK detection, doctor, devices and pub get"
        actions={
          <StatusPill
            tone={status?.flutter.available ? 'ok' : 'warn'}
            label={status?.flutter.available ? 'SDK found' : 'Not installed'}
          />
        }
      >
        <p className="font-mono text-[11px] text-muted">{status?.flutter.version ?? status?.flutter.hint ?? 'Probing…'}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'doctor'}
            disabled={!status?.flutter.available}
            onClick={() =>
              void runTask('doctor', async () => {
                const result = await call('flutter:doctor', null);
                setFlutterOut(result);
              })
            }
          >
            flutter doctor -v
          </Button>
          <Button
            size="sm"
            loading={busy === 'devices'}
            disabled={!status?.flutter.available}
            onClick={() =>
              void runTask('devices', async () => {
                const result = await call('flutter:devices', null);
                setFlutterDevices(result.devices);
                setFlutterOut({ code: 0, stdout: result.raw, stderr: '', timedOut: false, truncated: false, durationMs: 0 });
              })
            }
          >
            flutter devices
          </Button>
        </div>

        {flutterDevices.length > 0 && (
          <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line/60">
            {flutterDevices.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs text-ink">{device.name}</span>
                <span className="font-mono text-[11px] text-muted">{device.targetType}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Flutter project" hint="Folder containing pubspec.yaml — DroidBridge only runs pub get, it never edits files.">
                <input
                  className={`${inputClass} font-mono text-xs`}
                  readOnly
                  value={projectPath ?? ''}
                  placeholder="No folder selected"
                />
              </Field>
            </div>
            <Button size="sm" onClick={() => void pickFolder()} loading={busy === 'pick'}>
              <IconFolder size={13} />
              Browse…
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'pubget'}
              disabled={!projectPath || !status?.flutter.available}
              onClick={() =>
                void runTask('pubget', async () => {
                  if (!projectPath) return;
                  const result = await call('flutter:pub-get', { projectPath });
                  setFlutterOut(result);
                  setNotice(result.code === 0 ? 'flutter pub get succeeded.' : 'flutter pub get failed — see output.');
                })
              }
            >
              flutter pub get
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <OutputPanel result={flutterOut} empty="Run a Flutter command to see its real output here." />
        </div>
      </Card>

      <div className="space-y-5">
        <Card
          title="VS Code"
          description="Open projects in VS Code without touching their files"
          actions={
            <StatusPill tone={status?.vscode.available ? 'ok' : 'warn'} label={status?.vscode.available ? 'CLI found' : 'Not installed'} />
          }
        >
          <p className="font-mono text-[11px] text-muted">{status?.vscode.version ?? status?.vscode.hint ?? 'Probing…'}</p>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Folder" hint="Opens with `code <folder>` — no files are created or modified.">
                <input
                  className={`${inputClass} font-mono text-xs`}
                  readOnly
                  value={projectPath ?? ''}
                  placeholder="Pick a folder above"
                />
              </Field>
            </div>
            <Button
              size="sm"
              loading={busy === 'vscode'}
              disabled={!projectPath || !status?.vscode.available}
              onClick={() =>
                void runTask('vscode', async () => {
                  if (!projectPath) return;
                  await call('vscode:open-folder', { path: projectPath });
                  setNotice(`Opened ${projectPath} in VS Code.`);
                })
              }
            >
              Open in VS Code
            </Button>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Want launch configs for on-device debugging? Use the Flutter extension inside VS Code, or run
            <span className="font-mono text-slate-300"> flutter run </span> in the integrated terminal — DroidBridge
            keeps your project files untouched.
          </p>
        </Card>

        <Card
          title="scrcpy mirroring"
          description="Mirror and control the selected device in a window"
          actions={
            <StatusPill tone={status?.scrcpy.available ? 'ok' : 'warn'} label={status?.scrcpy.available ? 'Installed' : 'Missing'} />
          }
        >
          {!status?.scrcpy.available ? (
            <EmptyState
              icon={<IconExternal size={24} />}
              title="scrcpy is not installed"
              hint="Install it with: winget install Genymobile.scrcpy — then refresh. scrcpy is an open-source screen mirroring tool by Genymobile."
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Device">
                  <select className={inputClass} value={mirrorSerial} onChange={(e) => setMirrorSerial(e.target.value)}>
                    {readyDevices.length === 0 && <option value="">No authorized devices</option>}
                    {readyDevices.map((device) => (
                      <option key={device.serial} value={device.serial}>
                        {device.model ?? device.serial}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max FPS">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={240}
                      value={scrcpy.maxFps}
                      onChange={(e) => setScrcpy((s) => ({ ...s, maxFps: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label="Bitrate (Mbps)">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={100}
                      value={scrcpy.bitrateMbps}
                      onChange={(e) => setScrcpy((s) => ({ ...s, bitrateMbps: Number(e.target.value) }))}
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
                {(
                  [
                    ['noAudio', 'No audio'],
                    ['fullscreen', 'Fullscreen'],
                    ['alwaysOnTop', 'Always on top'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={scrcpy[key]}
                      onChange={(e) => setScrcpy((s) => ({ ...s, [key]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                {!scrcpySession ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === 'scrcpy-start'}
                    disabled={!mirrorSerial}
                    onClick={() => void startMirror()}
                  >
                    <IconPlay size={13} />
                    Start mirroring
                  </Button>
                ) : (
                  <Button variant="danger" size="sm" loading={busy === 'scrcpy-stop'} onClick={() => void stopMirror()}>
                    <IconStop size={13} />
                    Stop mirroring
                  </Button>
                )}
                <span className="text-[11px] text-muted">
                  {scrcpySession ? 'Mirroring — the window is controlled by scrcpy itself.' : 'Launches the real scrcpy binary.'}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      {error && (
        <p className="xl:col-span-2 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="xl:col-span-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-200">
          {notice}
        </p>
      )}
    </div>
  );
}
