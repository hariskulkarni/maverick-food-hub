'use client';
import { Bell, BellOff } from 'lucide-react';

/**
 * Small inline toggle for notification-sound preferences. The actual storage
 * lives in `useNotificationSound` — this component just renders the current
 * state and proxies a callback up.
 */
export interface SoundToggleProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  label?: string;
  className?: string;
}

export function SoundToggle({ enabled, onToggle, label, className }: SoundToggleProps) {
  const stateLabel = enabled ? 'Sound on' : 'Sound off';
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      title={label ?? stateLabel}
      aria-pressed={enabled}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
        enabled
          ? 'border-primary bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent',
        className ?? ''
      ].join(' ')}
    >
      {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      <span>{label ?? stateLabel}</span>
    </button>
  );
}
