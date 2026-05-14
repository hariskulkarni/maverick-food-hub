'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSSE } from '@/hooks/use-sse';
import { money } from '@/lib/utils';
import { MapPin, Navigation, Check } from 'lucide-react';
import { toast } from 'sonner';

interface PoolOrder {
  orderId: string; code: string; restaurant: string; branch: string;
  branchLoc: { lat: number; lng: number } | null;
  delivery: { line: string; lat: number | null; lng: number | null } | null;
  itemSummary: string; total: number; payout: number; distanceKm: number; readyAt: string;
}

export function PoolClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<PoolOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    const r = await fetch('/api/rider/pool');
    if (r.ok) setOrders(await r.json());
  }
  useEffect(() => { reload(); }, []);
  useSSE('rider:pool', { onMessage: () => reload() });

  async function claim(orderId: string) {
    setBusy(orderId);
    const r = await fetch(`/api/rider/pool/${orderId}/claim`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) return toast.error('Could not claim — ' + (await r.text()));
    toast.success('Claimed! Go to Active to start the delivery.');
    router.push('/rider');
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="display text-xl font-semibold">Available deliveries</h1>
        <p className="text-xs text-muted-foreground">{orders.length} order{orders.length === 1 ? '' : 's'} waiting. First to claim wins.</p>
      </header>
      {orders.length === 0 && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          Pool is empty right now. New orders appear here the moment a restaurant marks them ready.
        </div>
      )}
      {orders.map((o) => (
        <Card key={o.orderId}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono font-semibold">{o.code}</div>
                <div className="text-sm text-muted-foreground">{o.restaurant}</div>
                <div className="text-xs text-muted-foreground">{o.branch}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Payout</div>
                <div className="font-bold text-lg text-success">{money(o.payout)}</div>
                {o.distanceKm > 0 && <div className="text-xs text-muted-foreground">~{o.distanceKm} km</div>}
              </div>
            </div>
            {o.delivery && (
              <div className="text-sm flex items-start gap-2"><MapPin className="size-4 mt-0.5 text-muted-foreground" /> {o.delivery.line}</div>
            )}
            <p className="text-xs text-muted-foreground line-clamp-2">{o.itemSummary}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === o.orderId} onClick={() => claim(o.orderId)} className="flex-1">
                <Check className="size-4" /> {busy === o.orderId ? 'Claiming…' : 'Claim'}
              </Button>
              {o.delivery?.lat != null && o.delivery?.lng != null && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${o.delivery.lat},${o.delivery.lng}`} target="_blank" rel="noreferrer">
                    <Navigation className="size-4" />
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
