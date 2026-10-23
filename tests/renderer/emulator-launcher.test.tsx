// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmulatorLauncher } from '../../src/renderer/components/EmulatorLauncher';
import type { IpcEventMap } from '../../src/shared/types';

type ExitPayload = IpcEventMap['emulator:exit'];

/** Configurable per test: AVDs returned by emulator:list. */
let listAvds: string[] = [];
/** Configured failure for emulator:list (null = success). */
let listError: { code: string; message: string } | null = null;
/** Configured failure for emulator:start (null = success). */
let startError: { code: string; message: string } | null = null;

let emitExit: ((payload: ExitPayload) => void) | null = null;

function setupBridge(): void {
  emitExit = null;
  window.droidbridge = {
    invoke: vi.fn(async (channel: string, args: unknown) => {
      void args;
      if (channel === 'emulator:list') {
        return listError
          ? { ok: false, error: listError }
          : { ok: true, value: { avds: listAvds } };
      }
      if (channel === 'emulator:start') {
        return startError
          ? { ok: false, error: startError }
          : { ok: true, value: { sessionId: 'sess-1' } };
      }
      return { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` } };
    }) as Window['droidbridge']['invoke'],
    on: vi.fn((_event: string, listener: (payload: ExitPayload) => void) => {
      emitExit = listener;
      return () => undefined;
    }) as Window['droidbridge']['on'],
  } as Window['droidbridge'];
}

function emitExitEvent(payload: ExitPayload): void {
  act(() => emitExit?.(payload));
}

beforeEach(() => {
  listAvds = [];
  listError = null;
  startError = null;
  setupBridge();
});

afterEach(() => {
  cleanup();
});

describe('EmulatorLauncher (dashboard)', () => {
  it('shows the Start emulator button and boots a single AVD directly', async () => {
    listAvds = ['Pixel_7_API_34'];
    render(<EmulatorLauncher />);

    const button = screen.getByRole('button', { name: /start emulator/i });
    fireEvent.click(button);

    expect(window.droidbridge.invoke).toHaveBeenCalledWith('emulator:list', null);
    // Single AVD: no chooser — it starts immediately.
    expect(await screen.findByText(/starting Pixel_7_API_34/i)).toBeInTheDocument();
    expect(window.droidbridge.invoke).toHaveBeenCalledWith('emulator:start', { avd: 'Pixel_7_API_34' });
  });

  it('shows a chooser when several AVDs exist and starts the picked one', async () => {
    listAvds = ['Pixel_7_API_34', 'pixel_5_api_33'];
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));

    expect(await screen.findByRole('button', { name: 'Pixel_7_API_34' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pixel_5_api_33' })).toBeInTheDocument();
    // Nothing started yet — waiting for the user's pick.
    expect(window.droidbridge.invoke).not.toHaveBeenCalledWith('emulator:start', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'pixel_5_api_33' }));
    expect(window.droidbridge.invoke).toHaveBeenCalledWith('emulator:start', { avd: 'pixel_5_api_33' });
    expect(await screen.findByText(/starting pixel_5_api_33/i)).toBeInTheDocument();
  });

  it('surfaces an honest error when no emulator is installed', async () => {
    listError = { code: 'EMULATOR_NOT_FOUND', message: 'The Android emulator was not found on this machine.' };
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/emulator was not found/i);
    expect(window.droidbridge.invoke).not.toHaveBeenCalledWith('emulator:start', expect.anything());
  });

  it('explains when there are no AVDs to start', async () => {
    listAvds = [];
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no android virtual devices/i);
    expect(window.droidbridge.invoke).not.toHaveBeenCalledWith('emulator:start', expect.anything());
  });

  it('surfaces a start failure instead of claiming success', async () => {
    listAvds = ['Pixel_7_API_34'];
    startError = { code: 'EMULATOR_SPAWN_FAILED', message: 'Another emulator is already running for this AVD.' };
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already running/i);
    expect(screen.queryByText(/starting Pixel/i)).not.toBeInTheDocument();
  });

  it('reports a failed boot from the emulator:exit event', async () => {
    listAvds = ['Pixel_7_API_34'];
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));
    expect(await screen.findByText(/starting Pixel_7_API_34/i)).toBeInTheDocument();

    emitExitEvent({ sessionId: 'sess-1', avd: 'Pixel_7_API_34', code: 1, error: 'PANIC: missing system image' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/PANIC: missing system image/i);
    expect(screen.getByRole('button', { name: /start emulator/i })).toBeInTheDocument();
  });

  it('returns to idle when the emulator exits cleanly', async () => {
    listAvds = ['Pixel_7_API_34'];
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));
    expect(await screen.findByText(/starting Pixel_7_API_34/i)).toBeInTheDocument();

    emitExitEvent({ sessionId: 'sess-1', avd: 'Pixel_7_API_34', code: 0 });

    expect(await screen.findByRole('button', { name: /start emulator/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores exit events from other sessions', async () => {
    listAvds = ['Pixel_7_API_34'];
    render(<EmulatorLauncher />);

    fireEvent.click(screen.getByRole('button', { name: /start emulator/i }));
    expect(await screen.findByText(/starting Pixel_7_API_34/i)).toBeInTheDocument();

    emitExitEvent({ sessionId: 'someone-else', avd: 'Pixel_7_API_34', code: 1, error: 'not ours' });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/starting Pixel_7_API_34/i)).toBeInTheDocument();
  });
});
