'use client';
/**
 * Live-ops alert stack. Receives the OPEN+ACKNOWLEDGED escalations from the
 * server component, renders stacked alert cards with severity-coloured left
 * borders, and exposes Acknowledge / Resolve / Open-order actions.
 *
 * Auto-refreshes every 30s via router.refresh(), and exposes a manual "Refresh"
 * button that triggers a fresh scan against /api/platform/escalations/scan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import {
  AlertTriangle, Clock, Bike, Phone, Wallet, RefreshCw, ArrowUpRight, Loader2, Check,
  CheckCircle2, MapPin, ShieldAlert
} from 'lucide-react';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Status = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED';
type EscType =
  | 'ORDER_NOT_ACCEPTED'
  | 'KITCHEN_DELAY'
  | 'NO_RIDER_AVAILABLE'
  | 'RIDER_NOT_MOVING'
  | 'CUSTOMER_UNREACHABLE'
  | 'PAYMENT_WEBHOOK_DELAY'
  | 'COD_NOT_RECONCILED';

interface Escalation {
  id: string;
  orderId: string;
  type: EscType;
  severity: Severity;
  status: Status;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  order: {
    id: string;
    code: string;
    status: string;
    customer: { id: string; name: string | null; phone: string | null };
    branch: { name: string; restaurant: { id: string; name: string } };
    assignment?: { rider?: { user: { name: string | null; phone: string | null } | null } | null } | null;
  };
}

const SEV_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function LiveOpsClient({ initial }: { initial: Escalation[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Escalation[]>(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const refreshRef = useRef(() => router.refresh());
  refreshRef.current = () => router.refresh();

  // Keep local list in sync when server re-fetches
  useEffect(() => { setItems(initial); }, [initial]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => refreshRef.current(), 30_000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || +new Date(a.createdAt) - +new Date(b.createdAt)),
    [items]
  );

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      await fetch('/api/platform/escalations/scan', { method: 'POST', cache: 'no-store' });
      setLastScan(new Date());
      router.refresh();
    } finally {
      setScanning(false);
    }
  }, [router]);

  const act = useCallback(async (id: string, kind: 'acknowledge' | 'resolve') => {
    setPendingId(id);
    try {
      const res = await fetch(`/api/platform/escalations/${id}/${kind}`, { method: 'POST', cache: 'no-store' });
      if (res.ok) {
        if (kind === 'resolve') {
          setItems((curr) => curr.filter((x) => x.id !== id));
        } else {
          setItems((curr) => curr.map((x) => x.id === id ? { ...x, status: 'ACKNOWLEDGED' } : x));
        }
        router.refresh();
      }
    } finally {
      setPendingId(null);
    }
  }, [router]);

  return (
    <>
      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {scanning ? 'Scanning…' : 'Run scan now'}
          </Button>
          <div className="text-xs text-muted-foreground">
            {lastScan
              ? <>Last scan {lastScan.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>
              : <>Auto-refreshes every 30 seconds</>}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {sorted.length} active alert{sorted.length === 1 ? '' : 's'}
          </div>
        </CardContent>
      </Card>

      {/* Alert stack */}
      <div className="space-y-3">
        {sorted.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="grid size-12 mx-auto place-items-center rounded-full bg-success/15 text-success mb-3">
                <CheckCircle2 className="size-6" />
              </div>
              <div className="font-semibold">All clear.</div>
              <div className="text-xs text-muted-foreground mt-1">No open escalations. Sit back, sip the chai.</div>
            </CardContent>
          </Card>
        )}
        {sorted.map((e) => (
          <AlertCard
            key={e.id}
            esc={e}
            pending={pendingId === e.id}
            onAck={() => act(e.id, 'acknowledge')}
            onResolve={() => act(e.id, 'resolve')}
            onOpen={() => setActiveOrderId(e.orderId)}
          />
        ))}
      </div>

      {activeOrderId && (
        <OrderDrawer id={activeOrderId} onClose={() => setActiveOrderId(null)} />
      )}
    </>
  );
}

function AlertCard({
  esc, pending, onAck, onResolve, onOpen
}: {
  esc: Escalation;
  pending: boolean;
  onAck: () => void;
  onResolve: () => void;
  onOpen: () => void;
}) {
  const Icon = iconForType(esc.type);
  const borderCls = {
    CRITICAL: 'border-l-destructive',
    HIGH:     'border-l-warning',
    MEDIUM:   'border-l-yellow-500',
    LOW:      'border-l-border'
  }[esc.severity];
  const iconBg = {
    CRITICAL: 'bg-destructive/15 text-destructive',
    HIGH:     'bg-warning/15 text-warning',
    MEDIUM:   'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    LOW:      'bg-muted text-muted-foreground'
  }[esc.severity];
  const sevBadge =
    esc.severity === 'CRITICAL' ? 'destructive' :
    esc.severity === 'HIGH'     ? 'warning' :
    esc.severity === 'MEDIUM'   ? 'warning' : 'muted';

  return (
    <Card className={`border-l-4 ${borderCls}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={`relative grid size-11 place-items-center rounded-lg shrink-0 ${iconBg}`}>
            <Icon className="size-5" />
            {esc.severity === 'CRITICAL' && (
              <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-destructive pulse-soft" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={sevBadge as any} className="uppercase text-[10px] tracking-wider">{esc.severity}</Badge>
              {esc.status === 'ACKNOWLEDGED' && (
                <Badge variant="muted" className="text-[10px] uppercase tracking-wider">Acknowledged</Badge>
              )}
              <span className="font-mono text-xs font-semibold">{esc.order.code}</span>
              <span className="text-xs text-muted-foreground">· {humanType(esc.type)}</span>
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">{ageFrom(esc.createdAt)}</span>
            </div>

            <div className="mt-1.5 text-sm leading-snug">{esc.message}</div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="size-3.5" />
                <span className="truncate max-w-[240px]">{esc.order.branch.restaurant.name}</span>
              </span>
              {esc.order.assignment?.rider?.user?.name && (
                <span className="inline-flex items-center gap-1">
                  <Bike className="size-3.5" />
                  {esc.order.assignment.rider.user.name}
                </span>
              )}
              {esc.order.customer?.phone && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Phone className="size-3.5" />
                  {esc.order.customer.phone}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0 min-w-[124px]">
            {esc.status === 'OPEN' && (
              <Button size="sm" variant="outline" onClick={onAck} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Acknowledge
              </Button>
            )}
            <Button size="sm" variant="success" onClick={onResolve} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Resolve
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpen} disabled={pending}>
              <ArrowUpRight className="size-4" /> Open order
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/platform/orders/${id}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setData(d); setLoading(false); });
  }, [id]);

  if (loading || !data) {
    return (
      <DetailDrawer open onOpenChange={(v) => !v && onClose()} title="Loading…">
        <div className="grid place-items-center h-40"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      </DetailDrawer>
    );
  }

  const o = data;
  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={<span className="font-mono">{o.code}</span>}
      subtitle={`Placed ${new Date(o.placedAt).toLocaleString('en-IN')} · ${o.branch.restaurant.name}`}
      badge={<Badge variant="muted" className="text-[10px] uppercase">{o.status.replace(/_/g, ' ')}</Badge>}
      width="640px"
    >
      <DrawerSection title="Totals">
        <div className="p-4 grid grid-cols-2 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="text-right tabular-nums">₹{Number(o.subtotal).toLocaleString('en-IN')}</span>
          {Number(o.discountAmount) > 0 && (
            <>
              <span className="text-muted-foreground">Discount</span>
              <span className="text-right tabular-nums text-success">−₹{Number(o.discountAmount).toLocaleString('en-IN')}</span>
            </>
          )}
          <span className="text-muted-foreground">Tax</span>
          <span className="text-right tabular-nums">₹{Number(o.taxAmount).toLocaleString('en-IN')}</span>
          <span className="text-muted-foreground">Delivery</span>
          <span className="text-right tabular-nums">₹{Number(o.deliveryFee).toLocaleString('en-IN')}</span>
          <span className="border-t mt-2 pt-2 font-semibold">Total</span>
          <span className="border-t mt-2 pt-2 text-right tabular-nums font-bold text-primary">₹{Number(o.total).toLocaleString('en-IN')}</span>
        </div>
      </DrawerSection>

      <DrawerSection title={`Items (${o.items.length})`}>
        <ul className="divide-y text-sm">
          {o.items.map((i: any) => (
            <li key={i.id} className="p-3 flex items-center gap-3">
              <span className="text-muted-foreground w-8 text-right tabular-nums">{i.quantity}×</span>
              <span className="flex-1 truncate">{i.name}</span>
              <span className="font-mono tabular-nums">₹{(Number(i.unitPrice) * i.quantity).toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ul>
      </DrawerSection>

      <DrawerSection title="Customer">
        <div className="p-4 text-sm space-y-1.5">
          <div className="font-medium">{o.customer.name || '—'}</div>
          {o.customer.phone && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Phone className="size-3.5" /> <span className="font-mono">{o.customer.phone}</span>
            </div>
          )}
          {o.address && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              <span>{o.address.line1}{o.address.line2 ? `, ${o.address.line2}` : ''}, {o.address.city} {o.address.postalCode}</span>
            </div>
          )}
        </div>
      </DrawerSection>

      {o.assignment && (
        <DrawerSection title="Rider">
          <div className="p-4 text-sm space-y-1.5">
            <div className="flex items-center gap-2 font-medium">
              <Bike className="size-4 text-success" />
              {o.assignment.rider.user.name ?? o.assignment.rider.user.phone}
            </div>
            <div className="text-xs text-muted-foreground">Assignment status: <Badge variant="muted">{o.assignment.status}</Badge></div>
            <div className="text-xs text-muted-foreground">
              Earnings ₹{Number(o.assignment.earningsAmt).toLocaleString('en-IN')} (tip ₹{Number(o.assignment.tipAmt).toLocaleString('en-IN')})
            </div>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title={`Timeline (${o.statusEvents.length})`}>
        <ul className="p-4 space-y-2 text-sm">
          {o.statusEvents.map((e: any, i: number) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-primary shrink-0" />
              <span className="font-medium flex-1">{e.status.replace(/_/g, ' ')}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </li>
          ))}
        </ul>
      </DrawerSection>

      <DrawerSection title={`Payments (${o.payments.length})`}>
        <ul className="divide-y text-sm">
          {o.payments.map((p: any) => (
            <li key={p.id} className="p-3 flex items-center gap-3">
              <div className={`grid size-8 place-items-center rounded-lg shrink-0 ${p.status === 'CAPTURED' ? 'bg-success/10 text-success' : p.status === 'FAILED' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                {p.status === 'CAPTURED' ? <CheckCircle2 className="size-4" /> : p.status === 'FAILED' ? <AlertTriangle className="size-4" /> : <Clock className="size-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs">{p.method} · {p.status}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">{p.providerRef ?? p.providerName}</div>
              </div>
              <div className="font-semibold tabular-nums">₹{Number(p.amount).toLocaleString('en-IN')}</div>
            </li>
          ))}
          {o.payments.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">No payments recorded.</li>
          )}
        </ul>
      </DrawerSection>
    </DetailDrawer>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function iconForType(t: EscType) {
  switch (t) {
    case 'ORDER_NOT_ACCEPTED':    return AlertTriangle;
    case 'KITCHEN_DELAY':         return Clock;
    case 'NO_RIDER_AVAILABLE':    return Bike;
    case 'RIDER_NOT_MOVING':      return Bike;
    case 'CUSTOMER_UNREACHABLE':  return Phone;
    case 'PAYMENT_WEBHOOK_DELAY': return Wallet;
    case 'COD_NOT_RECONCILED':    return Wallet;
    default:                      return AlertTriangle;
  }
}

function humanType(t: EscType) {
  return ({
    ORDER_NOT_ACCEPTED:    'Order not accepted',
    KITCHEN_DELAY:         'Kitchen delay',
    NO_RIDER_AVAILABLE:    'No rider available',
    RIDER_NOT_MOVING:      'Rider not moving',
    CUSTOMER_UNREACHABLE:  'Customer unreachable',
    PAYMENT_WEBHOOK_DELAY: 'Payment webhook delay',
    COD_NOT_RECONCILED:    'COD not reconciled'
  } as Record<EscType, string>)[t] ?? t;
}

function ageFrom(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
