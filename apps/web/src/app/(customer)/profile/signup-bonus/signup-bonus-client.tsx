'use client';
/**
 * Customer-facing tracker.
 *
 *   - Hero with gradient progress bar — "₹X of ₹Y used"
 *   - Stats: total, used, pending, remaining balance, orders left
 *   - Friendly explainer "You unlock ₹{perOrderCap} on each delivered order…"
 *   - Ledger timeline of recent transactions
 *   - Empty state when no grant
 */
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Gift, Sparkles, Clock, ShoppingBag, ArrowRight, ArrowDownCircle, ArrowUpCircle, ShieldAlert, AlertCircle } from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';

type GrantView =
  | { hasGrant: false }
  | {
      hasGrant: true;
      totalAmount: number;
      perOrderCap: number;
      usedAmount: number;
      pendingAmount: number;
      remainingBalance: number;
      remainingOrders: number;
      expiresAt: string | null;
      revokedAt: string | null;
      revokedReason: string | null;
      splitCount: number;
    };

type LedgerRow = {
  id: string;
  kind: 'APPLY' | 'COMMIT' | 'RESTORE' | 'EXPIRE' | 'REVOKE' | 'GRANT' | string;
  delta: string | number;
  note: string | null;
  createdAt: string;
  order: { code: string; status: string } | null;
};

export function SignupBonusClient({
  view, ledger
}: {
  view: GrantView;
  ledger: LedgerRow[];
}) {
  if (!view.hasGrant) {
    return (
      <div className="space-y-6">
        <header>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary font-semibold">
            <Sparkles className="size-3.5" /> Welcome credit
          </div>
          <h1 className="display text-3xl font-semibold mt-1">My Signup Bonus</h1>
        </header>
        <EmptyState
          icon={Gift}
          title="No signup bonus active right now."
          description="If you signed up while a welcome credit was running, your balance and progress would appear here."
          action={
            <Button asChild>
              <Link href="/menu">Browse menu</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const v = view;
  const percentUsed = v.totalAmount > 0 ? Math.min(100, Math.max(0, (v.usedAmount / v.totalAmount) * 100)) : 0;
  const revoked = !!v.revokedAt;
  const expired = v.expiresAt ? new Date(v.expiresAt) < new Date() : false;
  const inactive = revoked || expired;

  return (
    <div className="space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary font-semibold">
          <Sparkles className="size-3.5" /> Welcome credit
        </div>
        <h1 className="display text-3xl font-semibold mt-1">My Signup Bonus</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track how much of your sign-up credit you've used, and how many qualifying orders are left.
        </p>
      </header>

      {/* ── Hero card ─────────────────────────────────────────────── */}
      <Card className={[
        'overflow-hidden border-primary/30',
        inactive ? 'bg-gradient-to-br from-muted/30 to-card' : 'bg-gradient-to-br from-primary/10 via-warning/5 to-card'
      ].join(' ')}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Your signup bonus</div>
              <div className="display text-3xl font-semibold mt-1">
                {money(v.usedAmount)} <span className="text-muted-foreground text-xl">of</span> {money(v.totalAmount)} <span className="text-muted-foreground text-base">used</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {revoked && <Badge variant="destructive">Revoked</Badge>}
              {!revoked && expired && <Badge variant="muted">Expired</Badge>}
              {!inactive && v.remainingOrders > 0 && v.remainingBalance > 0 && <Badge variant="success">Active</Badge>}
              {!inactive && (v.remainingOrders <= 0 || v.remainingBalance <= 0) && <Badge variant="muted">Used up</Badge>}
              {v.expiresAt && !revoked && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" /> {expired ? 'Expired' : 'Expires'} {fmtDate(v.expiresAt, { dateStyle: 'medium' })}
                </div>
              )}
            </div>
          </div>

          {/* Gradient progress bar */}
          <div className="space-y-1.5">
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary via-warning to-primary transition-all"
                style={{ width: `${Math.max(2, percentUsed)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{Math.round(percentUsed)}% used</span>
              <span>{money(v.remainingBalance)} left to unlock</span>
            </div>
          </div>

          {revoked && v.revokedReason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive flex items-start gap-2">
              <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>This bonus was revoked. Reason: {v.revokedReason}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stats grid ────────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <StatCard label="Total"      value={money(v.totalAmount)} />
        <StatCard label="Used"       value={money(v.usedAmount)}      tone="success" />
        <StatCard label="In flight"  value={money(v.pendingAmount)}   tone="warning" hint="Locked to an order in progress" />
        <StatCard label="Remaining"  value={money(v.remainingBalance)} tone="primary" />
        <StatCard label="Orders left" value={v.remainingOrders.toString()} hint="Qualifying orders" />
      </div>

      {/* ── Explainer ─────────────────────────────────────────────── */}
      {!inactive && v.remainingBalance > 0 && v.remainingOrders > 0 && (
        <Card>
          <CardContent className="p-4 flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Gift className="size-5" />
            </div>
            <div className="text-sm">
              <div className="font-medium">
                You unlock {money(v.perOrderCap)} on each delivered order — up to {v.splitCount} orders total.
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                The credit is applied automatically at checkout. You don't need a coupon code.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/menu">Order now <ArrowRight className="size-3.5" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Ledger timeline ───────────────────────────────────────── */}
      <section>
        <h2 className="font-semibold mb-3">Recent activity</h2>
        <Card>
          <CardContent className="p-0 divide-y">
            {ledger.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No activity yet. Place your first order to start using the credit.
              </div>
            )}
            {ledger.map((entry) => {
              const delta = Number(entry.delta);
              const text  = describeLedger(entry, delta);
              const Icon  = iconForKind(entry.kind);
              const colour =
                entry.kind === 'COMMIT' || entry.kind === 'APPLY' ? 'text-warning' :
                entry.kind === 'RESTORE' ? 'text-success' :
                entry.kind === 'REVOKE' || entry.kind === 'EXPIRE' ? 'text-destructive' :
                'text-primary';
              return (
                <div key={entry.id} className="flex items-start gap-3 p-4">
                  <div className={`grid size-9 place-items-center rounded-lg bg-muted ${colour} shrink-0`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{text.title}</div>
                    {text.detail && <div className="text-[11px] text-muted-foreground">{text.detail}</div>}
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(entry.createdAt)}</div>
                  </div>
                  {delta !== 0 && (
                    <div className={`font-mono text-sm tabular-nums shrink-0 ${delta < 0 ? 'text-destructive' : 'text-success'}`}>
                      {delta < 0 ? '−' : '+'}{money(Math.abs(delta))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
        <span>Credits are applied to the order subtotal after offers and coupons, then capped by your per-order limit.</span>
      </div>
    </div>
  );
}

// ─── Subcomponents + helpers ──────────────────────────────────────────────

function StatCard({ label, value, tone, hint }: { label: string; value: string; tone?: 'success' | 'primary' | 'warning'; hint?: string }) {
  const cls =
    tone === 'success' ? 'text-success' :
    tone === 'primary' ? 'text-primary' :
    tone === 'warning' ? 'text-warning' : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-lg font-bold mt-0.5 leading-tight ${cls}`}>{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function iconForKind(kind: string) {
  switch (kind) {
    case 'GRANT':   return Gift;
    case 'APPLY':   return ShoppingBag;
    case 'COMMIT':  return ArrowUpCircle;
    case 'RESTORE': return ArrowDownCircle;
    case 'REVOKE':  return ShieldAlert;
    case 'EXPIRE':  return Clock;
    default:        return Sparkles;
  }
}

function describeLedger(entry: LedgerRow, delta: number): { title: string; detail?: string } {
  const orderCode = entry.order?.code ? ` order ${entry.order.code}` : '';
  switch (entry.kind) {
    case 'GRANT':
      return { title: 'Signup bonus issued', detail: entry.note ?? undefined };
    case 'APPLY':
      return { title: `Applied ${money(delta)} to${orderCode}`, detail: 'Held while the order is in progress.' };
    case 'COMMIT':
      return { title: `Used ${money(delta)} on${orderCode}`, detail: 'Order delivered — credit unlocked.' };
    case 'RESTORE':
      return { title: `Restored ${money(Math.abs(delta))}${orderCode ? ' from' + orderCode : ''}`, detail: entry.note ?? 'Order was cancelled or refunded.' };
    case 'REVOKE':
      return { title: 'Bonus revoked by support', detail: entry.note ?? undefined };
    case 'EXPIRE':
      return { title: 'Bonus expired', detail: entry.note ?? undefined };
    default:
      return { title: entry.kind, detail: entry.note ?? undefined };
  }
}
