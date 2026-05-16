'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSSE } from '@/hooks/use-sse';
import { ChefHat, Package, Clock, Printer, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { KotLine } from './kot-line';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { SoundToggle } from '@/components/sound-toggle';
import { KitchenAttentionBanner } from '@/components/kitchen-attention-banner';

const COLUMNS = [
  { key: 'ACCEPTED', title: 'New', icon: Clock },
  { key: 'PREPARING', title: 'Preparing', icon: ChefHat },
  { key: 'READY', title: 'Ready', icon: Package }
] as const;

export function KitchenBoard({ branchId, initial }: { branchId: string; initial: any[] }) {
  const [orders, setOrders] = useState<any[]>(initial);
  const [now, setNow] = useState(Date.now());
  const [unacked, setUnacked] = useState<Set<string>>(new Set());

  // Looping kitchen chime — fires every 3s while there are unacknowledged
  // orders. The hook owns the audio element + autoplay-policy graceful fail.
  const chime = useNotificationSound('/sounds/kitchen.mp3', { loop: true, intervalMs: 3000 });
  const chimePlayingRef = useRef(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // Request browser notification permission once on mount — works only after
  // a user gesture in most browsers, but no harm asking here; if it's denied
  // we fall back to the banner + chime alone.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Drive looping chime from the unacked set — start when non-empty, stop
  // when drained. `chimePlayingRef` debounces so we don't re-arm the
  // interval on every render.
  useEffect(() => {
    if (unacked.size > 0 && !chimePlayingRef.current) {
      chime.play();
      chimePlayingRef.current = true;
    } else if (unacked.size === 0 && chimePlayingRef.current) {
      chime.stop();
      chimePlayingRef.current = false;
    }
  }, [unacked, chime]);

  // Also clear the chime if the operator disables the sound toggle while the
  // banner is up — the loop interval is already disarmed inside the hook,
  // we just resync the local ref so re-enabling restarts.
  useEffect(() => {
    if (!chime.enabled) chimePlayingRef.current = false;
  }, [chime.enabled]);

  useSSE(`branch:${branchId}:orders`, {
    onMessage: async (e: any) => {
      if (!e.orderId) return;
      const r = await fetch(`/api/admin/orders/${e.orderId}`);
      if (!r.ok) return;
      const o = await r.json();
      setOrders((prev) => {
        const without = prev.filter((x) => x.id !== o.id);
        if (['ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) return [...without, o].sort((a, b) => new Date(a.acceptedAt ?? a.placedAt).getTime() - new Date(b.acceptedAt ?? b.placedAt).getTime());
        return without;
      });
      // A new order or one freshly ACCEPTED — that's our "attention" trigger
      // for the kitchen. Track its id so we can clear it on acknowledge.
      if (e.kind === 'order:new' || (e.kind === 'status' && e.status === 'ACCEPTED')) {
        toast.info(`New order ${o.code}`);
        setUnacked((prev) => {
          const next = new Set(prev);
          next.add(o.id);
          return next;
        });
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('New order — Kitchen', {
              body: `Order ${o.code} needs attention`,
              tag: `kitchen-${o.code}`,
              requireInteraction: true,
              silent: false
            });
          } catch {
            /* notification API can throw in some browsers/contexts */
          }
        }
      }
    }
  });

  function acknowledge() {
    setUnacked(new Set());
  }

  async function transition(id: string, next: string) {
    const r = await fetch(`/api/admin/orders/${id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
    if (!r.ok) toast.error(await r.text());
  }

  return (
    <>
      <KitchenAttentionBanner count={unacked.size} onAcknowledge={acknowledge} />
      <div className="mb-3 flex items-center justify-end">
        <SoundToggle enabled={chime.enabled} onToggle={chime.setEnabled} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = orders.filter((o) => o.status === col.key);
        return (
          <section key={col.key}>
            <header className="flex items-center gap-2 mb-3">
              <col.icon className="size-5 text-primary" />
              <h2 className="display text-lg font-semibold">{col.title}</h2>
              <Badge variant="muted">{items.length}</Badge>
            </header>
            <div className="space-y-3">
              {items.length === 0 && <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">No orders here.</div>}
              {items.map((o) => {
                const startedAt = o.acceptedAt ? new Date(o.acceptedAt).getTime() : new Date(o.placedAt).getTime();
                const min = Math.floor((now - startedAt) / 60_000);
                const overdue = (o.status === 'PREPARING' || o.status === 'ACCEPTED') && min > 25;
                return (
                  <Card key={o.id} className={overdue ? 'border-destructive ring-2 ring-destructive/30' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono font-semibold text-base">{o.code}</div>
                          <div className="text-xs text-muted-foreground">{o.customer.name}</div>
                        </div>
                        <div className={`text-sm font-medium ${overdue ? 'text-destructive' : ''}`}>
                          {overdue && <AlertTriangle className="inline size-4 mr-1" />}
                          {min}m
                        </div>
                      </div>
                      <ul className="mt-3 text-sm space-y-1">
                        {o.items.map((i: any) => (
                          <KotLine
                            key={i.id}
                            name={i.name}
                            quantity={i.quantity}
                            comboBreakdown={i.comboBreakdown}
                          />
                        ))}
                      </ul>
                      {o.customerNotes && <p className="mt-2 text-xs text-warning bg-warning/10 rounded p-2">⚠ {o.customerNotes}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {o.status === 'ACCEPTED' && <Button size="sm" onClick={() => transition(o.id, 'PREPARING')}>Start preparing</Button>}
                        {o.status === 'PREPARING' && <Button size="sm" onClick={() => transition(o.id, 'READY')}>Mark ready</Button>}
                        <Button size="sm" variant="outline" asChild><a href={`/api/admin/orders/${o.id}/kot`} target="_blank" rel="noreferrer"><Printer className="size-4" /> KOT</a></Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>
    </>
  );
}
