'use client';
/**
 * ReassignModal — pulls the rider-allocator's suggestions for the order and
 * lets an operator hand the order to a different online rider in one click.
 *
 * Calls:
 *   GET  /api/admin/orders/{orderId}/suggest-riders → ranked candidate list
 *   POST /api/admin/orders/{orderId}/reassign       → swap the assignment
 *
 * `onClose(true)` is fired when a reassignment succeeded so the parent can
 * dismiss the side panel; `onClose(false)` for a plain cancel.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Bike, Loader2 } from 'lucide-react';

interface Candidate {
  riderId: string;
  riderName: string;
  distanceKm: number;
  currentLoad: number;
  rating: number;
  score: number;
}

export function ReassignModal({
  orderId,
  currentRiderId,
  onClose
}: {
  orderId: string;
  currentRiderId: string;
  onClose: (reassigned: boolean) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/orders/${orderId}/suggest-riders`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(setCandidates)
      .catch((e) => setError(String(e.message ?? e)));
  }, [orderId]);

  // Exclude the rider we're reassigning away from.
  const others = (candidates ?? []).filter((c) => c.riderId !== currentRiderId);

  const reassign = async (c: Candidate) => {
    setBusyId(c.riderId);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: c.riderId, reason: 'Ops reassign from live map' })
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text || `status ${r.status}`);
      }
      toast.success(`Reassigned to ${c.riderName}`);
      onClose(true);
    } catch (e: any) {
      toast.error(`Reassign failed: ${e.message ?? e}`);
      setBusyId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign order</DialogTitle>
        </DialogHeader>

        {error && <div className="text-sm text-destructive">Couldn't load candidates: {error}</div>}
        {!candidates && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="size-4 animate-spin" /> Loading candidates…
          </div>
        )}
        {candidates && others.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No other online riders are available for this branch right now.
          </div>
        )}

        <ul className="divide-y -mx-2">
          {others.map((c) => (
            <li key={c.riderId} className="flex items-center justify-between gap-3 px-2 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="grid size-9 place-items-center rounded-full bg-muted shrink-0">
                  <Bike className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{c.riderName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    ~{c.distanceKm} km · load {c.currentLoad} · {c.rating.toFixed(1)}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                disabled={busyId !== null}
                onClick={() => reassign(c)}
              >
                {busyId === c.riderId ? <Loader2 className="size-3.5 animate-spin" /> : 'Reassign'}
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onClose(false)} disabled={busyId !== null}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
