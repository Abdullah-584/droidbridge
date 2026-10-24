// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InstallButton } from '../../src/renderer/components/InstallButton';
import type { IpcEventMap } from '../../src/shared/types';

type ProgressPayload = IpcEventMap['tools:install-progress'];

let emitProgress: ((payload: ProgressPayload) => void) | null = null;
/** When set, the next tools:install invoke rejects with this error. */
let installFailure: { code: string; message: string } | null = null;

function setupBridge(): void {
  emitProgress = null;
  installFailure = null;
  window.droidbridge = {
    invoke: vi.fn(async (channel: string, args: unknown) => {
      void args;
      if (channel === 'tools:install') {
        return installFailure
          ? { ok: false, error: installFailure }
          : { ok: true, value: null };
      }
      return { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` } };
    }) as Window['droidbridge']['invoke'],
    on: vi.fn((_event: string, listener: (payload: ProgressPayload) => void) => {
      emitProgress = listener;
      return () => undefined;
    }) as Window['droidbridge']['on'],
  } as Window['droidbridge'];
}

function emit(payload: ProgressPayload): void {
  act(() => emitProgress?.(payload));
}

beforeEach(() => setupBridge());
afterEach(() => cleanup());

describe('InstallButton', () => {
  it('shows the per-tool label and invokes tools:install on click', async () => {
    render(<InstallButton tool="scrcpy" />);
    const button = screen.getByRole('button', { name: /install scrcpy/i });
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(window.droidbridge.invoke).toHaveBeenCalledWith('tools:install', { tool: 'scrcpy' }),
    );
    expect(screen.queryByRole('button', { name: /install flutter/i })).not.toBeInTheDocument();
    render(<InstallButton tool="flutter" />);
    expect(screen.getByRole('button', { name: /install flutter/i })).toBeInTheDocument();
  });

  it('streams live download percent from the main process', async () => {
    render(<InstallButton tool="adb" onInstalled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /install adb/i }));

    emit({ tool: 'adb', phase: 'downloading', percent: 42 });
    expect(screen.getByRole('button', { name: /installing… 42%/i })).toBeDisabled();

    emit({ tool: 'adb', phase: 'extracting', percent: 0 });
    expect(screen.getByRole('button', { name: /^installing…$/i })).toBeInTheDocument();

    emit({ tool: 'adb', phase: 'done', percent: 100 });
    expect(screen.getByRole('button', { name: /install adb/i })).toBeInTheDocument();
  });

  it('calls onInstalled on the done event so status can refresh', async () => {
    const onInstalled = vi.fn();
    render(<InstallButton tool="scrcpy" onInstalled={onInstalled} />);
    emit({ tool: 'scrcpy', phase: 'downloading', percent: 10 });
    emit({ tool: 'scrcpy', phase: 'done', percent: 100 });
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it('ignores progress events for other tools', () => {
    render(<InstallButton tool="adb" />);
    emit({ tool: 'scrcpy', phase: 'downloading', percent: 90 });
    expect(screen.getByRole('button', { name: /install adb/i })).toBeInTheDocument();
  });

  it('surfaces a rejected install as an alert', async () => {
    installFailure = { code: 'INSTALL_FAILED', message: 'winget exited with code 1.' };
    render(<InstallButton tool="code" label="VS Code" />);
    fireEvent.click(screen.getByRole('button', { name: /install vs code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/winget exited with code 1/i);
    expect(screen.getByRole('button', { name: /install vs code/i })).toBeInTheDocument();
  });

  it('surfaces an auto-install failure event (started by the app itself)', () => {
    render(<InstallButton tool="adb" />);
    emit({ tool: 'adb', phase: 'downloading', percent: 12 });
    emit({ tool: 'adb', phase: 'error', percent: 0, message: 'Download failed (HTTP 403).' });

    expect(screen.getByRole('alert')).toHaveTextContent(/download failed \(http 403\)/i);
    expect(screen.getByRole('button', { name: /install adb/i })).toBeInTheDocument();
  });

  it('clears a previous error when a new install starts', async () => {
    installFailure = { code: 'INSTALL_FAILED', message: 'network down' };
    render(<InstallButton tool="adb" />);
    fireEvent.click(screen.getByRole('button', { name: /install adb/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i);

    installFailure = null;
    fireEvent.click(screen.getByRole('button', { name: /install adb/i }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
