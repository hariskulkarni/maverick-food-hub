'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { Search, Download, RefreshCw, ArrowUpRight, X, Loader2, Phone, MapPin, Bike, Clock, CheckCircle2, AlertTriangle, Star, MessageSquare, Wallet, CreditCard, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = ['ALL', 'RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED'] as const;
const PAYMENTS = ['ALL', 'RAZORPAY', 'COD', 'WALLET', 'UPI'] as const;
const PERIODS  = [{ k: '7d', l: '7d' }, { k: '30d', l: '30d' }, { k: '90d', l: '90d' }, { k: 'all', l: 'All' }];

interface OrderRow {
  id: string;
  code: string;
  status: string;
  paymentMethod: string;
  total: any;
  placedAt: string;
  customer: { name: string | null; phone: string | null };
  branch: { name: string; restaurant: { name: string } };
  assignment?: { rider?: { user: { name: string | null } | null } | null } | null;
}

export function OrdersExplorer({ initial, restaurants, filters }: { initial: OrderRow[]; restaurants: { id: string; name: string }[]; filters: { status: string; payment: string; restaurantId: string; q: string; period: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [status, setStatus] = useState(filters.status || 'ALL');
  const [payment, setPayment] = useState(filters.payment || 'ALL');
  const [restaurantId, setRestaurantId] = useState(filters.restaurantId || '');
  const [period, setPeriod] = useState(filters.period || '30d');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      ['q', 'status', 'payment', 'restaurantId', 'period'].forEach((k) => sp.delete(k));
      if (q.trim()) sp.set('q', q.trim());
      if (status !== 'ALL') sp.set('status', status);
      if (payment !== 'ALL') sp.set('payment', payment);
      if (restaurantId) sp.set('restaurantId', restaurantId);
      if (period !== '30d') sp.set('period', period);
      router.replace(`/platform/orders?${sp.toString()}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, payment, restaurantId, period]);

  function exportCsv() {
    const head = ['Code', 'Status', 'Restaurant', 'Branch', 'Customer', 'Phone', 'Payment', 'Total', 'Rider', 'Placed at'];
    const rows = initial.map((o) => [
      o.code, o.status, o.branch.restaurant.name, o.branch.name,
      o.customer.name ?? '', o.customer.phone ?? '', o.paymentMethod,
      Number(o.total), o.assignment?.rider?.user?.name ?? '',
      new Date(o.placedAt).toISOString()
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order code, customer name, or phone" className="pl-9" />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
            </div>
            <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className="h-9 w-full sm:w-auto sm:min-w-[180px] rounded-md border bg-card px-2 text-sm">
              <option value="">All restaurants</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="flex items-center gap-1 ml-auto">
              {PERIODS.map((p) => (
                <Chip key={p.k} active={period === p.k} onClick={() => setPeriod(p.k)}>{p.l}</Chip>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}><RefreshCw className="size-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUS.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'All' : statusLabel(s)}
              </Chip>
            ))}
            <span className="text-xs text-muted-foreground ml-3 mr-1">Pay:</span>
            {PAYMENTS.map((p) => (
              <Chip key={p} active={payment === p} onClick={() => setPayment(p)}>{p === 'ALL' ? 'All' : p}</Chip>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Order</Th>
                  <Th>Restaurant</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th align="right">Total</Th>
                  <Th>Rider</Th>
                  <Th>Placed</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {initial.length === 0 && (
                  <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">No orders match these filters.</td></tr>
                )}
                {initial.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(o.id)}>
                    <td className="px-4 py-3 font-mono text-xs">{o.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[180px]">{o.branch.restaurant.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{o.branch.name.replace(/^.*—\s*/, '')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs truncate max-w-[140px]">{o.customer.name || '—'}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{o.customer.phone}</div>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={o.status} /></td>
                    <td className="px-4 py-3"><Badge variant="muted" className="text-[10px]">{o.paymentMethod}</Badge></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">₹{Number(o.total).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{o.assignment?.rider?.user?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(o.placedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveId(o.id); }}>
                        Open <ArrowUpRight className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeId && <OrderDrawer id={activeId} onClose={() => setActiveId(null)} />}
    </>
  );
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    return fetch(`/api/platform/orders/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); setLoading(false); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

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
      badge={<StatusPill status={o.status} />}
      width="640px"
    >
      <DrawerSection title="Totals">
        <div className="p-4 grid grid-cols-2 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Subtotal</span><span className="text-right tabular-nums">₹{Number(o.subtotal).toLocaleString('en-IN')}</span>
          {Number(o.discountAmount) > 0 && <><span className="text-muted-foreground">Discount</span><span className="text-right tabular-nums text-success">−₹{Number(o.discountAmount).toLocaleString('en-IN')}</span></>}
          <span className="text-muted-foreground">Tax</span><span className="text-right tabular-nums">₹{Number(o.taxAmount).toLocaleString('en-IN')}</span>
          <span className="text-muted-foreground">Delivery</span><span className="text-right tabular-nums">₹{Number(o.deliveryFee).toLocaleString('en-IN')}</span>
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
          {o.customer.phone && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="size-3.5" /> <span className="font-mono">{o.customer.phone}</span></div>}
          {o.address && <div className="flex items-start gap-2 text-xs text-muted-foreground"><MapPin className="size-3.5 mt-0.5 shrink-0" /> <span>{o.address.line1}{o.address.line2 ? `, ${o.address.line2}` : ''}, {o.address.city} {o.address.postalCode}</span></div>}
        </div>
      </DrawerSection>

      {o.assignment && (
        <DrawerSection title="Rider">
          <div className="p-4 text-sm space-y-1.5">
            <div className="flex items-center gap-2 font-medium"><Bike className="size-4 text-success" />{o.assignment.rider.user.name ?? o.assignment.rider.user.phone}</div>
            <div className="text-xs text-muted-foreground">Assignment status: <Badge variant="muted">{o.assignment.status}</Badge></div>
            <div className="text-xs text-muted-foreground">Earnings ₹{Number(o.assignment.earningsAmt).toLocaleString('en-IN')} (tip ₹{Number(o.assignment.tipAmt).toLocaleString('en-IN')})</div>
            {o.assignment.deliveryPhotoUrl && (
              <a href={o.assignment.deliveryPhotoUrl} target="_blank" rel="noreferrer" className="block mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.assignment.deliveryPhotoUrl} alt="Proof of delivery" className="h-32 w-full object-cover rounded-lg border" />
              </a>
            )}
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="Customer feedback">
        <OrderFeedbackBlock orderId={o.id} />
      </DrawerSection>

      <DrawerSection title={`Timeline (${o.statusEvents.length})`}>
        <ul className="p-4 space-y-2 text-sm">
          {o.statusEvents.map((e: any, i: number) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-primary shrink-0" />
              <span className="font-medium flex-1">{statusLabel(e.status)}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
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
          {o.payments.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">No payments recorded.</li>}
        </ul>
      </DrawerSection>

      {o.refunds?.length > 0 && (
        <DrawerSection title={`Refunds (${o.refunds.length})`}>
          <ul className="divide-y text-sm">
            {o.refunds.map((r: any) => (
              <li key={r.id} className="p-3 flex items-center gap-3">
                <div className="grid size-8 place-items-center rounded-lg bg-destructive/10 text-destructive shrink-0">
                  {r.destination === 'WALLET' ? <Wallet className="size-4" /> : <CreditCard className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs">{r.destination === 'WALLET' ? 'To wallet' : 'To original payment'} · {r.status}</div>
                  <div className="text-[10px] text-muted-foreground">{r.reason ?? '—'} · {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
                <div className="font-semibold tabular-nums text-destructive">−₹{Number(r.amount).toLocaleString('en-IN')}</div>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}

      <DrawerSection title="Issue a refund">
        <RefundPanel order={o} onDone={load} />
      </DrawerSection>
    </DetailDrawer>
  );
}

function RefundPanel({ order, onDone }: { order: any; onDone: () => void }) {
  const REFUNDABLE = ['DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN', 'REFUND_PENDING', 'REFUND_INITIATED'];
  const alreadyRefunded = (order.refunds ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const remaining = Math.max(0, Math.round((Number(order.total) - alreadyRefunded) * 100) / 100);
  const hasCaptured = (order.payments ?? []).some((p: any) => p.status === 'CAPTURED');

  const [amount, setAmount] = useState<number>(remaining);
  const [destination, setDestination] = useState<'WALLET' | 'ORIGINAL_PAYMENT'>('WALLET');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!REFUNDABLE.includes(order.status)) {
    return <div className="p-4 text-xs text-muted-foreground">This order is not in a refundable state.</div>;
  }
  if (remaining <= 0) {
    return <div className="p-4 text-xs text-muted-foreground">Fully refunded — nothing left to refund.</div>;
  }

  async function submit() {
    if (!(amount > 0) || amount > remaining) {
      toast.error(`Enter an amount between ₹1 and ₹${remaining.toLocaleString('en-IN')}.`);
      return;
    }
    if (destination === 'ORIGINAL_PAYMENT' && !hasCaptured) {
      toast.error('No captured online payment to refund — use wallet.');
      return;
    }
    const ok = window.confirm(
      `Refund ₹${amount.toLocaleString('en-IN')} to ${destination === 'WALLET' ? "the customer's wallet" : 'the original payment method'}? This cannot be undone.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/orders/${order.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, destination, reason: reason || undefined })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        toast.error(j.message || 'Refund failed.');
        return;
      }
      toast.success(destination === 'WALLET' ? `₹${amount.toLocaleString('en-IN')} credited to wallet` : `₹${amount.toLocaleString('en-IN')} refunded to original payment`);
      setReason('');
      onDone();
    } catch {
      toast.error('Refund failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Refundable balance: <strong className="text-foreground">₹{remaining.toLocaleString('en-IN')}</strong>
        {alreadyRefunded > 0 && <> · already refunded ₹{alreadyRefunded.toLocaleString('en-IN')}</>}
      </div>

      {/* Destination — wallet is the default per platform policy. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setDestination('WALLET')}
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors ${destination === 'WALLET' ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
        >
          <Wallet className="size-4 text-primary shrink-0" />
          <div>
            <div className="font-medium">Customer wallet</div>
            <div className="text-[10px] text-muted-foreground">Instant · default</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setDestination('ORIGINAL_PAYMENT')}
          disabled={!hasCaptured}
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${destination === 'ORIGINAL_PAYMENT' ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
        >
          <CreditCard className="size-4 text-primary shrink-0" />
          <div>
            <div className="font-medium">Original payment</div>
            <div className="text-[10px] text-muted-foreground">{hasCaptured ? 'Via gateway' : 'No online payment'}</div>
          </div>
        </button>
      </div>

      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          max={remaining}
          step={1}
          value={amount || ''}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          placeholder="Amount"
          className="w-32 h-9"
        />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (logged)" className="h-9 flex-1" />
      </div>
      <Button size="sm" disabled={busy} onClick={submit} className="w-full">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Refund ₹{(amount || 0).toLocaleString('en-IN')} {destination === 'WALLET' ? 'to wallet' : 'to original payment'}
      </Button>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DELIVERED: 'bg-success/15 text-success border-success/30',
    OUT_FOR_DELIVERY: 'bg-primary/15 text-primary border-primary/30',
    READY: 'bg-warning/15 text-warning border-warning/30',
    PREPARING: 'bg-warning/15 text-warning border-warning/30',
    ACCEPTED: 'bg-primary/15 text-primary border-primary/30',
    RECEIVED: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-destructive/15 text-destructive border-destructive/30',
    REFUND_INITIATED: 'bg-destructive/15 text-destructive border-destructive/30',
    REFUNDED: 'bg-destructive/15 text-destructive border-destructive/30'
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status] ?? 'bg-muted'}`}>{statusLabel(status)}</span>;
}

function statusLabel(s: string) {
  return ({ RECEIVED: 'Placed', ACCEPTED: 'Accepted', PREPARING: 'Cooking', READY: 'Ready', OUT_FOR_DELIVERY: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REFUND_INITIATED: 'Refunding', REFUNDED: 'Refunded' } as Record<string, string>)[s] ?? s;
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Customer feedback block for the drawer. Calls /api/platform/feedback?orderId=…
 * (SUPER_ADMIN scope — full visibility). Shows "No feedback yet." for orders
 * without a row; renders nothing distracting while loading.
 */
const TAG_LABEL: Record<string, string> = {
  MISSING_ITEM: 'Missing item', WRONG_ITEM: 'Wrong item', COLD_FOOD: 'Cold food',
  PACKAGING_ISSUE: 'Packaging issue', FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery', RIDER_BEHAVIOR: 'Rider behaviour'
};
function OrderFeedbackBlock({ orderId }: { orderId: string }) {
  const [state, setState] = useState<{ loading: boolean; feedback: any | null }>({ loading: true, feedback: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/platform/feedback?orderId=${orderId}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { rows: [] })
      .then((j) => { if (!cancelled) setState({ loading: false, feedback: j.rows?.[0] ?? null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, feedback: null }); });
    return () => { cancelled = true; };
  }, [orderId]);

  if (state.loading) return <div className="p-4 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  const fb = state.feedback;
  if (!fb) return <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><MessageSquare className="size-4" /> No feedback yet.</div>;

  return (
    <div className="p-4 text-sm space-y-2">
      <RatingRow label="Food" value={fb.foodRating} />
      <RatingRow label="Delivery" value={fb.deliveryRating} />
      <RatingRow label="Overall" value={fb.overallRating} />
      {fb.issueTags?.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {fb.issueTags.map((t: string) => (
            <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t}</Badge>
          ))}
        </div>
      )}
      {fb.comment && (
        <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2 mt-2 italic">"{fb.comment}"</p>
      )}
      {fb.imageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={fb.imageUrl} alt="Feedback" className="mt-2 h-32 w-full object-cover rounded border" />
      )}
    </div>
  );
}
function RatingRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {value == null ? <span className="text-muted-foreground">—</span> : (
        <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={`size-3.5 ${i <= value ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`} />
          ))}
        </span>
      )}
    </div>
  );
}
