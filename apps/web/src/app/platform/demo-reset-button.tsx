'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RotateCcw, Loader2 } from 'lucide-react';

/**
 * DemoResetButton — pinned at the top of every /platform/* page when running
 * in demo mode. Two-tap confirm (so a slip never wipes a live demo mid-call).
 * Calls POST /api/platform/demo-reset which truncates the demo DB + reseeds.
 */
export function DemoResetButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/platform/demo-reset', { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Demo data reset — fresh baseline loaded.');
      router.refresh();
    } catch (e: any) {
      toast.error('Reset failed', { description: String(e?.message || e).slice(0, 200) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="sticky top-0 z-30 flex items-center justify-end gap-3 border-b bg-warning/5 px-4 py-2">
      <span className="text-xs text-muted-foreground">
        Demo controls
      </span>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
          confirming
            ? 'bg-destructive text-destructive-foreground'
            : 'border bg-card hover:bg-accent'
        }`}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        {confirming ? 'Click again to confirm' : 'Reset demo data'}
      </button>
    </div>
  );
}
