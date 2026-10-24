import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdbDevice, LogcatExportFormat, LogLevel } from '../../shared/types';
import { LOGCAT_BUFFERS, LOGCAT_EXPORT_FORMATS, LOGCAT_LEVELS } from '../../shared/types';
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
  const [exportFormat, setExportFormat] = useState<LogcatExportFormat>('log');
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
      const { path, count } = await logcat.exportLines(filtered, exportFormat);
      setNotice(`Exported ${count} lines to ${path}`);
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
            <select
              className={`${inputClass} w-auto py-1.5 text-xs`}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as LogcatExportFormat)}
              aria-label="Export format"
              disabled={busy}
            >
              {LOGCAT_EXPORT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  .{format}
                </option>
              ))}
            </select>
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
                    className={`rounded-[7px] border px-2 py-1 text-[11px] transition-colors duration-[var(--t-1)] disabled:opacity-50 ${
                      active
                        ? 'border-accent/45 bg-accent/12 text-accent'
                        : 'border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink-2'
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
              <IconSearch size={14} className="pointer-events-none absolute left-3 top-2.5 text-dim" />
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
              <p className="rounded-[8px] border border-err/25 bg-err/[0.07] px-3 py-2 text-[11.5px] text-err">{error}</p>
            )}
            {notice && (
              <p className="rounded-[8px] border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[11.5px] text-accent">{notice}</p>
            )}
            {logcat.exitInfo && !logcat.running && (
              <p className="rounded-[8px] border border-warn/25 bg-warn/[0.07] px-3 py-2 text-[11.5px] text-warn">
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
        <div className="recessed h-[calc(100vh-360px)] min-h-64 overflow-auto p-1 font-mono text-[11.5px] leading-5">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={<IconTerminal size={18} />}
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
                <div
                  key={`${logcat.sessionId ?? 'idle'}:${line.seq}`}
                  className="flex gap-3 rounded-[4px] px-3 py-px transition-colors duration-75 hover:bg-white/[0.04]"
                >
                  <span className="w-[118px] shrink-0 select-none whitespace-nowrap text-dim tabular-nums">
                    {line.time ?? ''}
                  </span>
                  <span className="w-10 shrink-0 select-none text-right text-dim tabular-nums">{line.pid ?? ''}</span>
                  <span className={`w-4 shrink-0 uppercase select-none ${logLevelClass(line.level)}`}>
                    {line.level ? line.level[0] : ''}
                  </span>
                  <span className="w-40 shrink-0 truncate text-info/80" title={line.tag ?? ''}>
                    {line.tag ?? ''}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-all text-ink-2">
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
