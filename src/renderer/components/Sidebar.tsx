import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconBridge,
  IconDashboard,
  IconDevice,
  IconLink,
  IconMoon,
  IconSun,
  IconTerminal,
  IconTools,
} from './icons';

export type ViewId = 'dashboard' | 'devices' | 'logcat' | 'pairing' | 'tools';

const NAV: { id: ViewId; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard size={15} />, hint: 'Overview and tool status' },
  { id: 'devices', label: 'Devices', icon: <IconDevice size={15} />, hint: 'Inspect and diagnose devices' },
  { id: 'logcat', label: 'Logcat', icon: <IconTerminal size={15} />, hint: 'Live device logs' },
  { id: 'pairing', label: 'Pairing', icon: <IconLink size={15} />, hint: 'USB and wireless setup' },
  { id: 'tools', label: 'Tools', icon: <IconTools size={15} />, hint: 'Flutter, VS Code, scrcpy' },
];

const THEME_KEY = 'droidbridge:theme';

function readStoredTheme(): 'dark' | 'light' {
  if (typeof localStorage === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage unavailable (e.g. hardened contexts) — default to dark */
  }
  return 'dark';
}

/**
 * Floating navigation rail: the primary liquid-glass surface. Carries the
 * brand identity, the five real views, the live device-count badge and the
 * theme switch (dark is the signature; light is equally polished).
 */
export function Sidebar({
  active,
  deviceCount,
  onSelect,
}: {
  active: ViewId;
  deviceCount: number;
  onSelect: (view: ViewId) => void;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(readStoredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return (
    <nav
      className="glass flex w-[188px] shrink-0 flex-col rounded-2xl"
      aria-label="Main navigation"
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3.5">
        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-line bg-gradient-to-b from-surface-3 to-surface text-accent shadow-[inset_0_1px_0_var(--glass-hi)]">
          <IconBridge size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] leading-tight font-semibold tracking-[-0.01em] text-ink">
            DroidBridge
          </p>
          <p className="text-[9px] tracking-[0.14em] text-dim uppercase">ADB workstation</p>
        </div>
      </div>

      {/* Views */}
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV.map((item) => {
          const selected = item.id === active;
          return (
            <li key={item.id} className="relative">
              {selected && (
                <span
                  className="absolute top-1/2 -left-0.5 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_var(--accent-line)]"
                  aria-hidden
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                title={item.hint}
                aria-current={selected ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[12.5px] transition-[background-color,color,box-shadow] duration-[var(--t-1)] ease-[var(--ease)] ${
                  selected
                    ? 'bg-accent/10 text-ink shadow-[inset_0_0_0_1px_var(--accent-line)]'
                    : 'text-muted hover:bg-white/[0.045] hover:text-ink'
                }`}
              >
                <span className={selected ? 'text-accent' : 'text-dim'} aria-hidden>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.id === 'devices' && deviceCount > 0 && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent tabular-nums">
                    {deviceCount}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer: theme switch + the product's security promise */}
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-between border-t border-line pt-3">
          <p className="pr-3 text-[10.5px] leading-snug text-dim">
            Real ADB only. DroidBridge never bypasses on-device authorization prompts.
          </p>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-2 text-muted transition-colors duration-[var(--t-1)] hover:bg-surface-3 hover:text-ink"
          >
            {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
          </button>
        </div>
      </div>
    </nav>
  );
}
