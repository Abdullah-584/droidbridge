// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Button, EmptyState, Field, StatusPill, inputClass } from '../../src/renderer/components/ui';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import { PairingView } from '../../src/renderer/views/PairingView';
import type { DevicesApi } from '../../src/renderer/hooks/useDevices';

afterEach(() => {
  cleanup();
});

const DEVICES: DevicesApi = {
  refresh: async () => undefined,
  devices: [
    { serial: 'R58M12ABCD', state: 'device', transport: 'usb', model: 'Pixel 7' },
    { serial: '192.168.1.5:5555', state: 'device', transport: 'tcp', model: 'Galaxy S10', ip: '192.168.1.5', port: 5555 },
  ],
  adb: { tool: 'adb', available: true, path: 'C:\\adb.exe', version: 'Android Debug Bridge version 36', source: 'path' },
  raw: '',
  error: null,
  loading: false,
  lastUpdated: Date.now(),
};

describe('UI primitives', () => {
  it('disables buttons while loading', () => {
    render(
      <Button loading variant="primary">
        Start
      </Button>,
    );
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('renders status pills with labels', () => {
    render(<StatusPill tone="ok" label="Connected" />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders empty states with a hint', () => {
    render(<EmptyState title="No devices" hint="Plug in a phone" />);
    expect(screen.getByText('No devices')).toBeInTheDocument();
    expect(screen.getByText('Plug in a phone')).toBeInTheDocument();
  });

  it('shows field errors', () => {
    render(
      <Field label="Host" error="Bad host">
        <input className={inputClass} />
      </Field>,
    );
    expect(screen.getByText('Bad host')).toBeInTheDocument();
  });
});

describe('Sidebar', () => {
  it('renders navigation and calls back', () => {
    const onSelect = vi.fn();
    render(<Sidebar active="dashboard" deviceCount={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /logcat/i }));
    expect(onSelect).toHaveBeenCalledWith('logcat');
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('PairingView', () => {
  beforeEach(() => {
    // The preload bridge is absent in jsdom; stub whatever the view touches.
    window.droidbridge = {
      invoke: vi.fn(async () => ({ ok: true, value: { devices: [], adb: DEVICES.adb, raw: '' } })),
      on: vi.fn(() => () => undefined),
    } as unknown as Window['droidbridge'];
  });

  it('validates the port before invoking adb', () => {
    render(<PairingView devices={DEVICES} />);
    fireEvent.change(screen.getByPlaceholderText('192.168.1.42'), { target: { value: '192.168.1.7' } });
    fireEvent.change(screen.getByPlaceholderText('42123'), { target: { value: '99999' } });
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));
    expect(screen.getByText(/Port must be 1–65535/)).toBeInTheDocument();
    expect(window.droidbridge.invoke).not.toHaveBeenCalled();
  });

  it('requires a host before connecting', () => {
    render(<PairingView devices={DEVICES} />);
    fireEvent.change(screen.getByPlaceholderText('42123'), { target: { value: '5555' } });
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    expect(screen.getByText(/Enter the device IP/)).toBeInTheDocument();
    expect(window.droidbridge.invoke).not.toHaveBeenCalled();
  });

  it('lists wireless devices with disconnect actions', () => {
    render(<PairingView devices={DEVICES} />);
    expect(screen.getByText(/Galaxy S10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});
