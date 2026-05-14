'use client';
/**
 * Saffron strip that pings the customer if they have delivered orders still
 * inside the 48h feedback window. Fetches /api/customer/feedback/pending
 * on mount and again whenever `refreshKey` changes (so saving feedback in
 * the dialog can dismiss the banner row).
 */
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Clock, ChevronRight } from 'lucide-react';

interface PendingOrder {
  orderId: string;
  orderCode: string;
  windowEndsAt: string;
}

interface Props {
  /** Called when the customer clicks the "Give feedback" button on a row. */
  onOpen: (orderId: string) => void;
  /** Bump to refetch (e.g. after saving feedback). */
  refreshKey?: number;
}

export function FeedbackBanner({ onOpen, refreshKey = 0 }: Props) {
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/customer/feedback/pending', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setPending(d.pending ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!loaded || pending.length === 0) return null;

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-warning/5 to-card shadow-sm">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-primary/20 bg-primary/5">
        <div className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30">
          <Sparkles className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            You have {pending.length} delivered order{pending.length > 1 ? 's' : ''} awaiting your feedback
          </div>
          <div className="text-xs text-muted-foreground">
            Share your thoughts before the 48-hour window closes.
          </div>
        </div>
      </div>
      <ul className="divide-y divide-primary/10">
        {pending.map((p) => (
          <li key={p.orderId} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-primary/5">
            <span className="font-mono font-medium">{p.orderCode}</span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" /> {formatRemaining(new Date(p.windowEndsAt))}
            </span>
            <button
              type="button"
              onClick={() => onOpen(p.orderId)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 tap-press"
            >
              Give feedback <ChevronRight className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatRemaining(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'closing soon';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m left`;
  return `${h}h ${m}m left`;
}
