'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pause, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Status = { paused: boolean; reason?: string; until?: string; indefinite?: boolean };

const PRESETS = [
  { label: '15 minutes', minutes: 15 as 15 | 30 | 60 | null },
  { label: '30 minutes', minutes: 30 as 15 | 30 | 60 | null },
  { label: '1 hour',     minutes: 60 as 15 | 30 | 60 | null },
  { label: 'Until I resume', minutes: null as 15 | 30 | 60 | null }
];

const REASONS = ['Too busy', 'Out of stock', 'Equipment issue', 'Closing early', 'Other'];

export function PauseControl({ branchId, initial }: { branchId: string; initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [now, setNow] = useState(() => Date.now());

  // Tick once per second so the "X min left" pill stays fresh.
  useEffect(() => {
    if (!status.paused || !status.until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status.paused, status.until]);

  // Auto-flip the pill back to Open once the timer elapses (the server-side
  // sweep is what really unpauses; this is just UI).
  useEffect(() => {
    if (status.paused && status.until && new Date(status.until).getTime() <= now) {
      setStatus({ paused: false });
    }
  }, [now, status]);

  async function pause(minutes: 15 | 30 | 60 | null) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/branch/${branchId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, reason })
      });
      if (!r.ok) {
        toast.error('Could not pause: ' + (await r.text()));
        return;
      }
      const data = await r.json();
      setStatus(data);
      setOpen(false);
      toast.success(minutes == null ? 'Branch paused until you resume' : `Branch paused for ${minutes} min`);
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/branch/${branchId}/unpause`, { method: 'POST' });
      if (!r.ok) {
        toast.error('Could not resume: ' + (await r.text()));
        return;
      }
      const data = await r.json();
      setStatus(data);
      toast.success('Branch is taking orders again');
    } finally {
      setBusy(false);
    }
  }

  const minutesLeft = status.until ? Math.max(0, Math.ceil((new Date(status.until).getTime() - now) / 60_000)) : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
      {status.paused ? (
        <span className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive">
          <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
          Paused
          {status.indefinite ? ' — until you resume' : minutesLeft != null ? ` — ${minutesLeft} min left` : ''}
          {status.reason ? ` · ${status.reason}` : ''}
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 text-sm font-medium text-success">
          <span className="inline-block size-2 rounded-full bg-success" />
          Open — accepting orders
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {status.paused ? (
          <Button size="sm" onClick={resume} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Resume
          </Button>
        ) : (
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} disabled={busy}>
              <Pause className="size-4" /> Pause orders
            </Button>
            {open && (
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border bg-popover p-3 shadow-lg">
                <label className="block text-xs font-medium text-muted-foreground">Reason</label>
                <select
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <div className="mt-3 grid gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => pause(p.minutes)}
                      disabled={busy}
                      className="rounded-md border px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
