// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UpdateBanner } from '../../src/renderer/components/UpdateBanner';
import { useUpdate } from '../../src/renderer/hooks/useUpdate';
import type { UpdateStatus } from '../../src/shared/types';

/** Mounts the real hook with the same props wiring as App.tsx. */
function Harness() {
  const update = useUpdate();
  return (
    <UpdateBanner
      status={update.status}
      installError={update.installError}
      onInstall={() => void update.install()}
      onDismiss={update.dismiss}
    />
  );
}

let emitStatus: ((status: UpdateStatus) => void) | null = null;
const emit = (status: UpdateStatus): void => {
  act(() => emitStatus?.(status));
};

afterEach(() => {
  cleanup();
});

describe('useUpdate + UpdateBanner', () => {
  beforeEach(() => {
    emitStatus = null;
    window.droidbridge = {
      invoke: vi.fn(async () => ({ ok: true, value: null })),
      on: vi.fn((_event: string, listener: (status: UpdateStatus) => void) => {
        emitStatus = listener;
        return () => undefined;
      }),
    } as unknown as Window['droidbridge'];
  });

  it('stays hidden while there is no update news', () => {
    render(<Harness />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    emit({ state: 'not-available' });
    emit({ state: 'error', message: 'offline' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('streams a downloaded update into a restartable banner', () => {
    render(<Harness />);
    emit({ state: 'downloaded', version: '1.2.0' });
    expect(screen.getByText(/Update v1\.2\.0 is ready/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restart now/i }));
    expect(window.droidbridge.invoke).toHaveBeenCalledWith('update:install', null);
  });

  it('shows live download progress', () => {
    render(<Harness />);
    emit({ state: 'downloading', percent: 42 });
    expect(screen.getByText(/Downloading update… 42%/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('hides on dismissal and re-opens for fresh information', () => {
    render(<Harness />);
    emit({ state: 'available', version: '1.2.0' });
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    emit({ state: 'downloaded', version: '1.2.0' });
    expect(screen.getByText(/Update v1\.2\.0 is ready/)).toBeInTheDocument();
  });

  it('surfaces install failures instead of failing silently', async () => {
    (window.droidbridge.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'No update has been downloaded yet.' },
    });
    render(<Harness />);
    emit({ state: 'downloaded', version: '1.2.0' });
    fireEvent.click(screen.getByRole('button', { name: /restart now/i }));
    expect(await screen.findByText(/No update has been downloaded yet\./)).toBeInTheDocument();
  });
});
