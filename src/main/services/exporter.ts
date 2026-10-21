import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { DroidBridgeError } from '../errors';
import type { LogcatExportFormat, LogcatLine } from '../../shared/types';

/**
 * The only writer of user-chosen files. The path always comes from the native
 * save dialog — the renderer never supplies a filesystem path — and the
 * serialized content is built here from validated, structured lines.
 */

const EXTENSIONS: Record<LogcatExportFormat, string> = { log: 'log', json: 'json', csv: 'csv' };

const FILTER_NAMES: Record<LogcatExportFormat, string> = {
  log: 'Log files',
  json: 'JSON',
  csv: 'CSV',
};

/** Versioned JSON envelope so future parsers can evolve safely. */
const JSON_SCHEMA = 'droidbridge.logcat/1';

/** UTF-8 BOM: added only when non-ASCII text is present (see csv/json notes). */
const NON_ASCII_RE = /[^\x00-\x7f]/;

/** Raw `.log`: the exact lines as streamed, one per row. */
export function serializeLog(lines: readonly LogcatLine[]): string {
  return `${lines.map((line) => line.raw).join('\n')}\n`;
}

/**
 * JSON with full parsed fields. A UTF-8 BOM is prepended only for non-ASCII
 * content (e.g. Arabic tags) so Windows tools like Excel/Notepad detect the
 * encoding; pure-ASCII exports stay BOM-free for strict JSON parsers.
 */
export function serializeJson(lines: readonly LogcatLine[], exportedAt: Date): string {
  const payload = {
    schema: JSON_SCHEMA,
    exportedAt: exportedAt.toISOString(),
    count: lines.length,
    lines: lines.map((line) => ({ ...line })),
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  return NON_ASCII_RE.test(body) ? `\uFEFF${body}` : body;
}

/** RFC 4180 quoting: wrap fields containing commas/quotes/newlines, double inner quotes. */
function csvField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV with column headers, CRLF row separators and RFC 4180 quoting. Same BOM
 * policy as JSON: BOM only when the content contains non-ASCII text, so Excel
 * opens Arabic tags correctly while ASCII exports stay portable.
 */
export function serializeCsv(lines: readonly LogcatLine[]): string {
  const header = 'seq,time,pid,tid,level,tag,message,raw';
  const rows = lines.map((line) =>
    [line.seq, line.time, line.pid, line.tid, line.level, line.tag, line.message, line.raw]
      .map(csvField)
      .join(','),
  );
  const body = `${[header, ...rows].join('\r\n')}\r\n`;
  return NON_ASCII_RE.test(body) ? `\uFEFF${body}` : body;
}

/** Timestamped default filename, e.g. `logcat-2026-10-19-14-23-05.csv`. */
export function buildExportFileName(format: LogcatExportFormat, now: Date): string {
  const stamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `logcat-${stamp}.${EXTENSIONS[format]}`;
}

/** Injectable dependencies — keeps every path here testable without Electron. */
export interface ExporterDeps {
  showSaveDialog: (
    window: BrowserWindow | undefined,
    options: { title: string; defaultPath: string; filters: { name: string; extensions: string[] }[] },
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  now: () => Date;
}

const defaultDeps: ExporterDeps = {
  showSaveDialog: (window, options) =>
    window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options),
  writeFile: (filePath, content) => fs.writeFile(filePath, content, 'utf8'),
  now: () => new Date(),
};

/** Serializes, asks the user where to save, and writes the file. */
export async function exportLogcat(
  format: LogcatExportFormat,
  lines: readonly LogcatLine[],
  window?: BrowserWindow,
  deps: ExporterDeps = defaultDeps,
): Promise<{ path: string; count: number }> {
  const content =
    format === 'json'
      ? serializeJson(lines, deps.now())
      : format === 'csv'
        ? serializeCsv(lines)
        : serializeLog(lines);

  const result = await deps.showSaveDialog(window, {
    title: `Export logcat (${format})`,
    defaultPath: buildExportFileName(format, deps.now()),
    filters: [
      { name: FILTER_NAMES[format], extensions: [EXTENSIONS[format]] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) {
    throw new DroidBridgeError('EXPORT_CANCELLED', 'Export cancelled.');
  }
  await deps.writeFile(result.filePath, content);
  return { path: result.filePath, count: lines.length };
}
