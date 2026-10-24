import type { UpdateStatus } from '../../shared/types';
import { Button } from './ui';

export interface UpdateBannerProps {
  status: UpdateStatus | null;
  installError: string | null;
  onInstall: () => void;
  onDismiss: () => void;
}

const BAR = 'relative flex items-center justify-between gap-4 px-5 py-2 text-[12.5px] border-b border-line';

/**
 * Non-blocking update ribbon under the header. Silent while checking,
 * up-to-date or failing — it only speaks when there is something to say.
 * The downloading state carries a real progress hairline (percent from the
 * main process), not a decorative animation.
 */
export function UpdateBanner({ status, installError, onInstall, onDismiss }: UpdateBannerProps) {
  if (!status) return null;

  if (status.state === 'available') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`${BAR} border-l-2 border-l-accent bg-accent/[0.07]`}
      >
        <span className="min-w-0 truncate text-ink-2">
          Update v{status.version} is available — downloading in the background…
        </span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Later
        </Button>
      </div>
    );
  }

  if (status.state === 'downloading') {
    const percent = Math.max(0, Math.min(100, status.percent));
    return (
      <div
        role="status"
        aria-live="polite"
        className={`${BAR} border-l-2 border-l-accent bg-accent/[0.07]`}
      >
        <span className="min-w-0 truncate text-ink-2">Downloading update… {status.percent}%</span>
        <div
          className="absolute inset-x-0 bottom-[-1px] h-px bg-accent transition-[width] duration-300 ease-[var(--ease)]"
          style={{ width: `${percent}%` }}
          aria-hidden
        />
      </div>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <div role="status" aria-live="polite" className={`${BAR} border-l-2 border-l-warn bg-warn/[0.07]`}>
        <span className="min-w-0 text-ink-2">
          Update v{status.version} is ready — restart installs it silently in the
          background (no setup wizard) and reopens DroidBridge.
          {installError && <span className="ml-2 text-err">{installError}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="primary" onClick={onInstall}>
            Restart now
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
        </span>
      </div>
    );
  }

  return null;
}
