import { describe, expect, it, vi } from 'vitest';
import {
  buildExportFileName,
  exportLogcat,
  serializeCsv,
  serializeJson,
  serializeLog,
  type ExporterDeps,
} from '../../src/main/services/exporter';
import { DroidBridgeError } from '../../src/main/errors';
import type { LogcatLine } from '../../src/shared/types';

const LINES: LogcatLine[] = [
  { seq: 1, raw: '10-18 22:57:33.123  1234  5678 I Tag: hello', time: '10-18 22:57:33.123', pid: 1234, tid: 5678, level: 'info', tag: 'Tag', message: 'hello' },
  { seq: 2, raw: '10-18 22:57:33.124  1234  5678 W Slow, "quoted": warn line', time: '10-18 22:57:33.124', pid: 1234, tid: 5678, level: 'warn', tag: 'Slow, "quoted"', message: 'warn line' },
  { seq: 3, raw: '--------- beginning of main', time: null, pid: null, tid: null, level: null, tag: null, message: null },
];

describe('serializeLog', () => {
  it('writes the raw lines verbatim with a trailing newline', () => {
    const content = serializeLog(LINES);
    expect(content).toBe(`${LINES.map((l) => l.raw).join('\n')}\n`);
  });
});

describe('serializeJson', () => {
  it('round-trips every parsed field under a versioned envelope', () => {
    const payload = JSON.parse(serializeJson(LINES, new Date('2026-10-19T14:23:05.123Z')));
    expect(payload.schema).toBe('droidbridge.logcat/1');
    expect(payload.exportedAt).toBe('2026-10-19T14:23:05.123Z');
    expect(payload.count).toBe(3);
    expect(payload.lines).toHaveLength(3);
    expect(payload.lines[0]).toEqual(LINES[0]);
    expect(payload.lines[2].message).toBeNull();
  });

  it('adds a UTF-8 BOM only when the content contains non-ASCII text', () => {
    expect(serializeJson(LINES, new Date()).startsWith('\uFEFF')).toBe(false);
    const arabic: LogcatLine[] = [{ ...LINES[0], tag: 'الشارة', message: 'مرحبا' }];
    expect(serializeJson(arabic, new Date()).startsWith('\uFEFF')).toBe(true);
  });
});

describe('serializeCsv', () => {
  it('emits a fixed header row and CRLF row separators', () => {
    const content = serializeCsv(LINES);
    const rows = content.split('\r\n');
    expect(rows[0]).toBe('seq,time,pid,tid,level,tag,message,raw');
    expect(rows).toHaveLength(LINES.length + 2); // header + rows + trailing empty
    expect(rows[1]).toBe('1,10-18 22:57:33.123,1234,5678,info,Tag,hello,10-18 22:57:33.123  1234  5678 I Tag: hello');
  });

  it('quotes fields containing commas/quotes/newlines per RFC 4180', () => {
    const tricky: LogcatLine[] = [
      { seq: 1, raw: 'raw, with "quotes"\nand newline', time: null, pid: null, tid: null, level: 'info', tag: 'a,b', message: 'say "hi"' },
    ];
    const row = serializeCsv(tricky).split('\r\n')[1];
    // tag "a,b" and message say "hi" and the raw field are all quoted; inner quotes doubled.
    expect(row).toBe('1,,,,info,"a,b","say ""hi""","raw, with ""quotes""\nand newline"');
  });

  it('renders null fields as empty cells', () => {
    const row = serializeCsv([LINES[2]]).split('\r\n')[1];
    expect(row).toBe('3,,,,,,,--------- beginning of main');
  });

  it('adds a UTF-8 BOM only for non-ASCII content', () => {
    expect(serializeCsv(LINES).startsWith('\uFEFF')).toBe(false);
    const arabic: LogcatLine[] = [{ ...LINES[0], message: 'مرحبا' }];
    expect(serializeCsv(arabic).startsWith('\uFEFF')).toBe(true);
  });
});

describe('buildExportFileName', () => {
  it('produces a timestamped, extension-correct filename', () => {
    const now = new Date('2026-10-19T14:23:05.123Z');
    expect(buildExportFileName('log', now)).toBe('logcat-2026-10-19-14-23-05.log');
    expect(buildExportFileName('json', now)).toBe('logcat-2026-10-19-14-23-05.json');
    expect(buildExportFileName('csv', now)).toBe('logcat-2026-10-19-14-23-05.csv');
  });
});

function fakeDeps(overrides: Partial<ExporterDeps> = {}): {
  deps: ExporterDeps;
  saved: { path: string; content: string }[];
  dialogs: { defaultPath?: string; extensions?: string[] }[];
} {
  const saved: { path: string; content: string }[] = [];
  const dialogs: { defaultPath?: string; extensions?: string[] }[] = [];
  const deps: ExporterDeps = {
    showSaveDialog: vi.fn(async (_window, options) => {
      dialogs.push({
        defaultPath: options.defaultPath,
        extensions: options.filters[0]?.extensions,
      });
      return { canceled: false, filePath: 'C:/Users/me/Documents/chosen.log' };
    }),
    writeFile: vi.fn(async (path, content) => {
      saved.push({ path, content });
    }),
    now: () => new Date('2026-10-19T14:23:05.123Z'),
    ...overrides,
  };
  return { deps, saved, dialogs };
}

describe('exportLogcat', () => {
  it('serializes in the requested format and returns the chosen path', async () => {
    const { deps, saved, dialogs } = fakeDeps();
    const result = await exportLogcat('csv', LINES, undefined, deps);
    expect(result).toEqual({ path: 'C:/Users/me/Documents/chosen.log', count: 3 });
    expect(saved[0].content).toBe(serializeCsv(LINES));
    expect(dialogs[0].defaultPath).toBe('logcat-2026-10-19-14-23-05.csv');
    expect(dialogs[0].extensions).toEqual(['csv']);
  });

  it('suggests the format-matched extension and filter in the save dialog', async () => {
    const { deps, dialogs } = fakeDeps();
    await exportLogcat('json', LINES, undefined, deps);
    expect(dialogs[0].defaultPath).toBe('logcat-2026-10-19-14-23-05.json');
    expect(dialogs[0].extensions).toEqual(['json']);
  });

  it('surfaces cancellation as a structured EXPORT_CANCELLED error', async () => {
    const { deps, saved } = fakeDeps({
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    });
    await expect(exportLogcat('log', LINES, undefined, deps)).rejects.toMatchObject({
      code: 'EXPORT_CANCELLED',
    });
    await expect(exportLogcat('log', LINES, undefined, deps)).rejects.toBeInstanceOf(DroidBridgeError);
    expect(saved).toHaveLength(0);
  });

  it('propagates write failures instead of reporting a phantom path', async () => {
    const { deps } = fakeDeps({
      writeFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await expect(exportLogcat('log', LINES, undefined, deps)).rejects.toThrow('disk full');
  });
});
