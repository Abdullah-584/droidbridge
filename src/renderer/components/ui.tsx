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
    'bg-accent text-accent-ink border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-[1.08] active:brightness-[0.96]',
  subtle:
    'bg-surface-2 text-ink-2 border border-line hover:bg-surface-3 hover:text-ink hover:border-line-strong',
  ghost: 'text-muted border border-transparent hover:bg-white/5 hover:text-ink',
  danger:
    'text-err border border-[color-mix(in_oklab,var(--err)_35%,transparent)] bg-[color-mix(in_oklab,var(--err)_9%,transparent)] hover:bg-[color-mix(in_oklab,var(--err)_16%,transparent)]',
};

const SIZES: Record<Size, string> = {
  sm: 'text-[11.5px] px-2.5 py-1 gap-1.5 rounded-[7px]',
  md: 'text-[12.5px] px-3.5 py-[7px] gap-2 rounded-[8px]',
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
      className={`inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,filter,transform] duration-[var(--t-1)] ease-[var(--ease)] active:translate-y-px disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
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
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            )}
            {description && <p className="mt-0.5 text-[11.5px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
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
    ok: 'text-ok bg-ok/10 border-ok/25',
    warn: 'text-warn bg-warn/10 border-warn/25',
    error: 'text-err bg-err/10 border-err/25',
    idle: 'text-muted bg-white/[0.04] border-line',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-2 text-[11px] font-medium ${tones[tone]}`}
    >
      <span
        className={`size-[5px] rounded-full bg-current ${pulse ? 'animate-breathe' : ''}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong/70 bg-surface-2/40 px-6 py-9 text-center">
      {icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-dim">
          {icon}
        </div>
      )}
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {hint && <p className="max-w-md text-[11.5px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-err">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** Compact switch used for boolean tool options. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex select-none items-center gap-2 text-[12px] text-ink-2 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[17px] w-[29px] shrink-0 rounded-full border transition-colors duration-[var(--t-1)] ${
          checked ? 'border-accent/50 bg-accent/25' : 'border-line bg-surface-3'
        }`}
      >
        <span
          className={`absolute top-[2px] size-[11px] rounded-full transition-[left,background-color] duration-[var(--t-1)] ease-[var(--ease)] ${
            checked ? 'left-[14px] bg-accent' : 'left-[2px] bg-dim'
          }`}
        />
      </button>
      {label}
    </label>
  );
}

export const inputClass =
  'w-full rounded-[8px] border border-line bg-surface-2 px-3 py-[7px] text-[12.5px] text-ink placeholder:text-dim transition-colors duration-[var(--t-1)] focus:border-accent/60 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20';
