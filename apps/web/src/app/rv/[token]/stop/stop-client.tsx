'use client';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportApiError } from '@/lib/api-error';

export function StopClient({ token, restaurantName }: { token: string; restaurantName: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'restaurant' | 'all' | null>(null);

  async function stop(scope: 'restaurant' | 'all') {
    setBusy(true);
    try {
      const r = await fetch(`/api/review-requests/${encodeURIComponent(token)}/opt-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      if (!r.ok) {
        await reportApiError(r, 'Could not update your preference');
        return;
      }
      setDone(scope);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-4 flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        {done === 'all'
          ? "Done. You won't get review requests from any restaurant on this platform."
          : `Done. You won't get review requests from ${restaurantName} again.`}
      </p>
    );
  }
  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-muted-foreground">
        Order updates are not affected. Choose which review requests to stop:
      </p>
      <Button disabled={busy} onClick={() => stop('restaurant')} className="h-11 w-full">
        Stop requests from {restaurantName}
      </Button>
      <Button disabled={busy} variant="outline" onClick={() => stop('all')} className="h-11 w-full">
        Stop requests from all restaurants
      </Button>
    </div>
  );
}
