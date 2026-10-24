import type { UpdateStatus } from '../../shared/types';
import { Button } from './ui';

export interface UpdateBannerProps {
  status: UpdateStatus | null;
  installError: string | null;
  onInstall: () => void;
  onDismiss: () => void;
}

const BAR =
  'flex items-center justify-between gap-4 border-b px-6 py-2.5 text-sm';
const TONE = {
  pending: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200',
  ready: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
} as const;

/**
 * Non-blocking update banner shown under the header. Silent while checking,
 * up-to-date or failing — it only speaks when there is something to say.
 */
export function UpdateBanner({ status, installError, onInstall, onDismiss }: UpdateBannerProps) {
  if (!status) return null;

  if (status.state === 'available') {
    return (
      <div role="status" aria-live="polite" className={`${BAR} ${TONE.pending}`}>
        <span>
          Update v{status.version} is available — downloading in the background…
        </span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Later
        </Button>
      </div>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div role="status" aria-live="polite" className={`${BAR} ${TONE.pending}`}>
        <span>Downloading update… {status.percent}%</span>
      </div>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <div role="status" aria-live="polite" className={`${BAR} ${TONE.ready}`}>
        <span className="min-w-0">
          Update v{status.version} is ready — restart installs it silently in the
          background (no setup wizard) and reopens DroidBridge.
          {installError && <span className="ml-2 text-rose-300">{installError}</span>}
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
