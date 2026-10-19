import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40 hover:bg-cyan-400/25 hover:border-cyan-300/60',
  ghost: 'text-slate-300 border border-transparent hover:bg-white/5 hover:text-white',
  danger: 'bg-rose-500/10 text-rose-300 border border-rose-400/40 hover:bg-rose-500/20',
  subtle: 'bg-white/5 text-slate-200 border border-line hover:bg-white/10',
};

const SIZES: Record<Size, string> = {
  sm: 'text-xs px-2.5 py-1.5 gap-1.5',
  md: 'text-sm px-3.5 py-2 gap-2',
};

export function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-panel shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StatusPill({
  tone,
  label,
  pulse = false,
}: {
  tone: 'ok' | 'warn' | 'error' | 'idle';
  label: string;
  pulse?: boolean;
}) {
  const tones = {
    ok: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
    warn: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
    error: 'text-rose-300 bg-rose-400/10 border-rose-400/30',
    idle: 'text-slate-300 bg-white/5 border-white/10',
  } as const;
  const dots = {
    ok: 'bg-emerald-400',
    warn: 'bg-amber-400',
    error: 'bg-rose-400',
    idle: 'bg-slate-400',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${dots[tone]} ${pulse ? 'animate-pulse-soft' : ''}`} aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line/80 px-6 py-10 text-center">
      {icon && <div className="text-slate-500">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/40';
