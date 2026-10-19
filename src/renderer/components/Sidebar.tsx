import type { ReactNode } from 'react';
import {
  IconDashboard,
  IconDevice,
  IconLink,
  IconTerminal,
  IconTools,
} from './icons';

export type ViewId = 'dashboard' | 'devices' | 'logcat' | 'pairing' | 'tools';

const NAV: { id: ViewId; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard />, hint: 'Overview and tool status' },
  { id: 'devices', label: 'Devices', icon: <IconDevice />, hint: 'Inspect and diagnose devices' },
  { id: 'logcat', label: 'Logcat', icon: <IconTerminal />, hint: 'Live device logs' },
  { id: 'pairing', label: 'Pairing', icon: <IconLink />, hint: 'USB and wireless setup' },
  { id: 'tools', label: 'Tools', icon: <IconTools />, hint: 'Flutter, VS Code, scrcpy' },
];

/** App navigation rail. */
export function Sidebar({
  active,
  deviceCount,
  onSelect,
}: {
  active: ViewId;
  deviceCount: number;
  onSelect: (view: ViewId) => void;
}) {
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-panel/60" aria-label="Main navigation">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-slate-900">
          <IconDevice size={17} />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight text-ink">DroidBridge</p>
          <p className="text-[10px] uppercase tracking-widest text-muted">ADB workspace</p>
        </div>
      </div>

      <ul className="mt-2 flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const selected = item.id === active;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={selected ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  selected
                    ? 'bg-cyan-400/10 text-cyan-200 border border-cyan-400/30'
                    : 'text-slate-300 border border-transparent hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={selected ? 'text-cyan-300' : 'text-slate-500'}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.id === 'devices' && deviceCount > 0 && (
                  <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
                    {deviceCount}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="px-5 py-4 text-[10px] leading-relaxed text-muted">
        Real ADB only. DroidBridge never bypasses on-device authorization prompts.
      </footer>
    </nav>
  );
}
