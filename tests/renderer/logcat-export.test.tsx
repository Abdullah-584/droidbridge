// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LogcatView } from '../../src/renderer/views/LogcatView';
import type { AdbDevice, IpcEventMap } from '../../src/shared/types';

const DEVICE: AdbDevice = { serial: 'R58M12ABCD', state: 'device', transport: 'usb', model: 'Pixel 7' };
const SESSION = 'session-12345678';

const LINES: IpcEventMap['logcat:lines']['lines'] = [
  { seq: 1, raw: '10-18 22:57:33.123  1234  5678 I Tag: hello', time: '10-18 22:57:33.123', pid: 1234, tid: 5678, level: 'info', tag: 'Tag', message: 'hello' },
  { seq: 2, raw: '10-18 22:57:33.124  1234  5678 W Slow: warn', time: '10-18 22:57:33.124', pid: 1234, tid: 5678, level: 'warn', tag: 'Slow', message: 'warn' },
];

let listeners: Record<string, (payload: never) => void> = {};

function emit<E extends keyof IpcEventMap>(event: E, payload: IpcEventMap[E]): void {
  act(() => listeners[event]?.(payload as never));
}

afterEach(() => {
  cleanup();
});

describe('LogcatView export', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView (used by the follow-the-tail effect).
    Element.prototype.scrollIntoView = vi.fn();
    listeners = {};
    window.droidbridge = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'logcat:start') return { ok: true, value: { sessionId: SESSION } };
        if (channel === 'logcat:export') return { ok: true, value: { path: 'C:/Users/me/export.csv', count: 2 } };
        return { ok: true, value: null };
      }),
      on: vi.fn((event: string, listener: (payload: never) => void) => {
        listeners[event] = listener;
        return () => undefined;
      }),
    } as unknown as Window['droidbridge'];
  });

  /** Starts a session and streams two lines into the view. */
  async function startWithLines(): Promise<void> {
    render(<LogcatView devices={[DEVICE]} initialSerial={DEVICE.serial} />);
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    // Flush the async start() so the session id is registered before lines arrive.
    await act(async () => undefined);
    emit('logcat:lines', { sessionId: SESSION, lines: LINES });
    expect(screen.getByText('hello')).toBeInTheDocument();
  }

  it('sends the selected format and the structured lines over IPC', async () => {
    await startWithLines();

    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'csv' } });
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(await screen.findByText(/Exported 2 lines to C:\/Users\/me\/export\.csv/)).toBeInTheDocument();
    expect(window.droidbridge.invoke).toHaveBeenCalledWith('logcat:export', {
      format: 'csv',
      lines: LINES,
    });
  });

  it('defaults to .log and honors a format switch to .json', async () => {
    await startWithLines();

    expect(screen.getByLabelText('Export format')).toHaveValue('log');
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'json' } });
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    await screen.findByText(/Exported 2 lines/);
    expect(window.droidbridge.invoke).toHaveBeenCalledWith('logcat:export', {
      format: 'json',
      lines: LINES,
    });
  });

  it('surfaces a cancelled export instead of pretending success', async () => {
    (window.droidbridge.invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (channel: string) => {
        if (channel === 'logcat:start') return { ok: true, value: { sessionId: SESSION } };
        if (channel === 'logcat:export') {
          return { ok: false, error: { code: 'EXPORT_CANCELLED', message: 'Export cancelled.' } };
        }
        return { ok: true, value: null };
      },
    );
    await startWithLines();

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(await screen.findByText('Export cancelled.')).toBeInTheDocument();
    expect(screen.queryByText(/Exported \d+ lines/)).not.toBeInTheDocument();
  });
});
