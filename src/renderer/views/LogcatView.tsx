import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdbDevice, LogcatLine, LogLevel } from '../../shared/types';
import { LOGCAT_BUFFERS, LOGCAT_LEVELS } from '../../shared/types';
import { Button, Card, EmptyState, Field, inputClass } from '../components/ui';
import { IconExport, IconPause, IconPlay, IconSearch, IconStop, IconTerminal, IconTrash } from '../components/icons';
import { filterLogLines, logLevelClass } from '../lib/format';
import { useLogcat } from '../hooks/useLogcat';

interface Props {
  devices: AdbDevice[];
  initialSerial: string | null;
}

function serialsDevices(devices: AdbDevice[]): AdbDevice[] {
  return devices.filter((d) => d.state === 'device');
}

/** Live logcat viewer: streaming, filtering, pause, clear and export. */
export function LogcatView({ devices, initialSerial }: Props) {
  const logcat = useLogcat();
  const [serial, setSerial] = useState<string | null>(initialSerial);
  const [buffers, setBuffers] = useState<string[]>(['main']);
  const [minLevel, setMinLevel] = useState<LogLevel>('verbose');
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const ready = serialsDevices(devices);

  useEffect(() => {
    if (!serial && ready.length > 0) setSerial(initialSerial ?? ready[0].serial);
  }, [ready, serial, initialSerial]);

  const filtered = useMemo(
    () => filterLogLines(logcat.lines, search, minLevel),
    [logcat.lines, search, minLevel],
  );

  useEffect(() => {
    if (follow && !logcat.paused) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [filtered.length, follow, logcat.paused]);

  const start = async () => {
    if (!serial) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await logcat.start({
        serial,
        buffers: buffers as (typeof LOGCAT_BUFFERS)[number][],
        level: minLevel,
        filterSpecs: [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await logcat.stop();
    } finally {
      setBusy(false);
    }
  };

  const clearBuffer = async () => {
    if (!serial) return;
    setBusy(true);
    setError(null);
    try {
      await logcat.clearDeviceBuffer(serial);
      logcat.clear();
      setNotice('Device log buffer cleared (adb logcat -c).');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportVisible = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await logcat.exportLines(filtered.map((line: LogcatLine) => line.raw));
      setNotice(`Exported ${filtered.length} lines to ${path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <Card
        title="Logcat"
        description={logcat.running ? `Streaming from ${logcat.sessionId?.slice(0, 8)}…` : 'Stream live device logs over ADB'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!logcat.running ? (
              <Button variant="primary" size="sm" disabled={!serial} loading={busy} onClick={() => void start()}>
                <IconPlay size={13} />
                Start
              </Button>
            ) : (
              <Button variant="danger" size="sm" loading={busy} onClick={() => void stop()}>
                <IconStop size={13} />
                Stop
              </Button>
            )}
            <Button size="sm" disabled={!serial} loading={busy} onClick={() => void clearBuffer()} title="adb logcat -c">
              <IconTrash size={13} />
              Clear device buffer
            </Button>
            <Button size="sm" disabled={filtered.length === 0} loading={busy} onClick={() => void exportVisible()}>
              <IconExport size={13} />
              Export
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Device">
            <select
              className={inputClass}
              value={serial ?? ''}
              onChange={(e) => setSerial(e.target.value || null)}
              disabled={logcat.running}
            >
              {ready.length === 0 && <option value="">No authorized devices</option>}
              {ready.map((device) => (
                <option key={device.serial} value={device.serial}>
                  {device.model ?? device.serial} ({device.serial})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Buffers" hint="adb -b flags">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {LOGCAT_BUFFERS.map((buffer) => {
                const active = buffers.includes(buffer);
                return (
                  <button
                    key={buffer}
                    type="button"
                    disabled={logcat.running}
                    onClick={() =>
                      setBuffers((prev) =>
                        prev.includes(buffer) ? prev.filter((b) => b !== buffer) : [...prev, buffer],
                      )
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                      active
                        ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                        : 'border-line bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]'
                    }`}
                  >
                    {buffer}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Min level">
            <select className={inputClass} value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)}>
              {LOGCAT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Search" hint="Plain text or /regex/">
            <div className="relative">
              <IconSearch size={14} className="pointer-events-none absolute left-3 top-2.5 text-slate-500" />
              <input
                className={`${inputClass} pl-9`}
                placeholder="tag, message, pid…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </Field>
        </div>

        {(error || notice || logcat.exitInfo) && (
          <div className="mt-4 space-y-2">
            {error && (
              <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p>
            )}
            {notice && (
              <p className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-200">{notice}</p>
            )}
            {logcat.exitInfo && !logcat.running && (
              <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                Session ended (code {logcat.exitInfo.code ?? 'n/a'}
                {logcat.exitInfo.error ? `: ${logcat.exitInfo.error}` : ''}).
              </p>
            )}
          </div>
        )}
      </Card>

      <Card
        className="min-h-0 flex-1"
        bodyClassName="p-0"
        title={`${filtered.length} lines${logcat.lines.length !== filtered.length ? ` (of ${logcat.lines.length})` : ''}`}
        description={logcat.paused ? `Paused — ${logcat.lines.length ? 'new lines buffered' : 'no lines yet'}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => logcat.setPaused(!logcat.paused)} disabled={!logcat.running}>
              {logcat.paused ? <IconPlay size={13} /> : <IconPause size={13} />}
              {logcat.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" onClick={() => logcat.clear()} disabled={logcat.lines.length === 0}>
              Clear view
            </Button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              Follow
            </label>
          </div>
        }
      >
        <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto bg-[#080d18] font-mono text-[11.5px] leading-5">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<IconTerminal size={26} />}
                title={logcat.running ? 'Waiting for log output…' : 'No log lines'}
                hint={
                  logcat.running
                    ? 'Interact with the device to generate logs.'
                    : 'Pick an authorized device and press Start to stream logcat in real time.'
                }
              />
            </div>
          ) : (
            <>
              {filtered.map((line) => (
                <div key={line.seq} className="flex gap-3 px-4 py-px hover:bg-white/[0.04]">
                  <span className="w-20 shrink-0 select-none text-slate-600">{line.time ?? ''}</span>
                  <span className="w-12 shrink-0 select-none text-right text-slate-500">{line.pid ?? ''}</span>
                  <span className={`w-10 shrink-0 uppercase select-none ${logLevelClass(line.level)}`}>
                    {line.level ? line.level[0] : ''}
                  </span>
                  <span className="w-44 shrink-0 truncate text-indigo-300" title={line.tag ?? ''}>
                    {line.tag ?? ''}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-all text-slate-200">
                    {line.message ?? line.raw}
                  </span>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
