'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function AssignRiderDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/orders/${orderId}/suggest-riders`).then((r) => r.json()).then(setCandidates);
  }, [orderId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign rider</DialogTitle>
        </DialogHeader>
        {!candidates && <p className="text-sm text-muted-foreground">Loading suggestions…</p>}
        {candidates?.length === 0 && <p className="text-sm text-muted-foreground">No riders online for this branch right now.</p>}
        <ul className="divide-y">
          {candidates?.map((c) => (
            <li key={c.riderId} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{c.riderName}</div>
                <div className="text-xs text-muted-foreground">~{c.distanceKm} km · load {c.currentLoad} · ⭐ {c.rating.toFixed(1)}</div>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await fetch(`/api/admin/orders/${orderId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ riderId: c.riderId }) });
                  setBusy(false);
                  if (!r.ok) return toast.error('Failed');
                  toast.success(`Assigned ${c.riderName}`);
                  onClose();
                }}
              >
                Assign
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch(`/api/admin/orders/${orderId}/auto-assign`, { method: 'POST' });
            setBusy(false);
            if (!r.ok) return toast.error('No rider available');
            toast.success('Auto-assigned');
            onClose();
          }}
        >Auto-assign best</Button>
      </DialogContent>
    </Dialog>
  );
}
