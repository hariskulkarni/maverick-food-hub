'use client';
/**
 * Earnings & payouts — same endpoints and client rules as the app's Earnings
 * tab and payouts screen (apps/rider-native/app/payouts.tsx). The server
 * enforces the balance check; a withdrawal is RECORDED and processed by the
 * Flavrly team (no automatic transfer).
 */
import { useState } from 'react';
import { Download, Loader2, Trophy, Banknote, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { riderApi, rupees, fmtDateTime, fmtDate } from '../../_lib/api';
import type { EarningsSummary, Incentive, Payout, PayoutsResponse } from '../../_lib/types';
import { ErrorPanel, PageHeader, Panel, Stat, inputCls, useLoad } from '../../_components/bits';

const PAYOUT_STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Requested', cls: 'bg-warning/15 text-warning' },
  PROCESSING: { label: 'Processing', cls: 'bg-primary/10 text-primary' },
  PAID: { label: 'Paid', cls: 'bg-success/15 text-success' },
  FAILED: { label: 'Failed', cls: 'bg-destructive/10 text-destructive' },
};

export function EarningsView() {
  const earn = useLoad(() => riderApi<EarningsSummary>('/api/rider/earnings'));
  const pay = useLoad(() => riderApi<PayoutsResponse>('/api/rider/payouts'));
  const inc = useLoad(() => riderApi<{ incentives: Incentive[] }>('/api/rider/incentives'));

  const days = earn.data?.last7Days ?? [];
  const maxDay = Math.max(1, ...days.map((d) => d.earnings));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Earnings & payouts"
        intro="Your delivery earnings, withdrawals and incentive progress."
        action={
          <a
            href="/api/rider/reports/statement?format=csv"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold hover:bg-muted"
          >
            <Download className="size-4" /> Statement (CSV)
          </a>
        }
      />

      {earn.error ? (
        <ErrorPanel message={earn.error} onRetry={earn.reload} />
      ) : earn.loading && !earn.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : earn.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat tone="primary" label="Today" value={rupees(earn.data.today.earnings)} sub={goalSub(earn.data.today.earnings, earn.data.goals?.daily, `${earn.data.today.deliveries} deliveries`)} />
            <Stat label="This week" value={rupees(earn.data.week?.earnings ?? 0)} sub={goalSub(earn.data.week?.earnings ?? 0, earn.data.goals?.weekly, `${earn.data.week?.deliveries ?? 0} deliveries`)} />
            <Stat label="Lifetime" value={rupees(earn.data.lifetime.totalEarnings)} sub={`incl. ${rupees(earn.data.lifetime.totalTips)} tips`} />
            <Stat label="Deliveries" value={String(earn.data.lifetime.totalDeliveries)} sub={`${earn.data.lifetime.rating.toFixed(1)} ★ rating`} />
          </div>

          {days.length > 0 && (
            <Panel title="Last 7 days">
              <ol className="flex h-40 items-end gap-2" aria-label="Earnings for the last 7 days">
                {days.map((d) => (
                  <li key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-muted-foreground">{d.earnings > 0 ? rupees(Math.round(d.earnings)) : ''}</span>
                    <span
                      className="w-full max-w-10 rounded-t-md bg-primary/80"
                      style={{ height: `${Math.max(2, (d.earnings / maxDay) * 100)}%` }}
                      title={`${d.date}: ${rupees(d.earnings)} · ${d.deliveries} deliveries`}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </>
      ) : null}

      <Payouts state={pay} />

      <Panel title="Incentives">
        {inc.error ? (
          <ErrorPanel message={inc.error} onRetry={inc.reload} />
        ) : inc.loading && !inc.data ? (
          <Skeleton className="h-16" />
        ) : (inc.data?.incentives ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No incentive targets are running right now.</p>
        ) : (
          <ul className="space-y-3">
            {inc.data!.incentives.map((i) => {
              const pct = Math.min(100, Math.round((i.deliveriesDone / Math.max(1, i.targetDeliveries)) * 100));
              return (
                <li key={i.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      <Trophy className={cn('size-4', i.achieved ? 'text-success' : 'text-primary')} /> {i.title}
                    </div>
                    <span className="text-sm font-semibold">{rupees(i.bonusAmount)} bonus</span>
                  </div>
                  {i.description && <p className="mt-1 text-xs text-muted-foreground">{i.description}</p>}
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn('h-full rounded-full', i.achieved ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {i.achieved ? 'Target reached!' : `${i.deliveriesDone}/${i.targetDeliveries} deliveries · ${i.remaining} to go`} ·{' '}
                    {i.period === 'DAILY' ? 'today' : 'this week'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {earn.data && earn.data.recent.length > 0 && (
        <Panel title="Recent deliveries">
          <ul className="divide-y">
            {earn.data.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">#{r.orderCode}</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(r.deliveredAt)}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{rupees(r.earnings)}</div>
                  {r.tip > 0 && <div className="text-xs text-success">+{rupees(r.tip)} tip</div>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function goalSub(value: number, goal: number | undefined, fallback: string): string {
  if (!goal || goal <= 0) return fallback;
  return `${fallback} · ${Math.min(100, Math.round((value / goal) * 100))}% of ${rupees(goal)} goal`;
}

function Payouts({ state }: { state: ReturnType<typeof useLoad<PayoutsResponse>> }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'UPI' | 'BANK'>('UPI');
  const [upiId, setUpiId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const available = state.data?.availableBalance ?? 0;

  function validate(): string | null {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return 'Type how much you want to withdraw.';
    if (amt > available) return `You can withdraw up to ${rupees(available)} right now.`;
    if (method === 'UPI' && !upiId.trim()) return 'Enter the UPI ID you want the money sent to.';
    return null;
  }

  async function submit() {
    setBusy(true);
    try {
      const amt = Number(amount);
      const res = await riderApi<{ payout: Payout }>('/api/rider/payouts', {
        method: 'POST',
        body: { amount: amt, method, ...(method === 'UPI' ? { upiId: upiId.trim() } : {}) },
      });
      toast.success(`Withdrawal of ${rupees(res.payout.amount)} requested. The Flavrly team will process it and mark it Paid once the money is sent.`);
      setAmount('');
      setUpiId('');
      setConfirming(false);
      await state.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Withdraw">
      {state.error ? (
        <ErrorPanel message={state.error} onRetry={state.reload} />
      ) : state.loading && !state.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const err = validate();
              if (err) return toast.error(err);
              setConfirming(true);
            }}
          >
            <div className="rounded-xl bg-success/10 p-3">
              <div className="text-xs text-muted-foreground">Available to withdraw</div>
              <div className="display text-2xl font-bold">{rupees(available)}</div>
              <div className="text-xs text-muted-foreground">
                Paid out so far {rupees(state.data?.totalPaidOut)} · cash you still carry from COD orders is held back.
              </div>
            </div>
            <div>
              <Label htmlFor="po-amount">Amount (₹)</Label>
              <input
                id="po-amount"
                inputMode="decimal"
                className={cn(inputCls, 'mt-1')}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                  setConfirming(false);
                }}
                placeholder="0"
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Send to</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['UPI', 'BANK'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={method === m}
                    onClick={() => {
                      setMethod(m);
                      setConfirming(false);
                    }}
                    className={cn(
                      'flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-semibold',
                      method === m ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted',
                    )}
                  >
                    {m === 'UPI' ? <Zap className="size-4" /> : <Banknote className="size-4" />}
                    {m === 'UPI' ? 'UPI' : 'Bank account'}
                  </button>
                ))}
              </div>
            </fieldset>
            {method === 'UPI' ? (
              <div>
                <Label htmlFor="po-upi">UPI ID</Label>
                <input
                  id="po-upi"
                  className={cn(inputCls, 'mt-1')}
                  value={upiId}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => {
                    setUpiId(e.target.value);
                    setConfirming(false);
                  }}
                  placeholder="yourname@upi"
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">We send it to the bank account on file with the Flavrly team.</p>
            )}
            {confirming ? (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                <p>
                  Request {rupees(Number(amount))} to {method === 'UPI' ? upiId.trim() : 'your bank account'}? The Flavrly team processes the
                  request and transfers the money; you can track the status here.
                </p>
                <div className="flex gap-2">
                  <Button type="button" onClick={submit} disabled={busy} className="min-h-11 flex-1">
                    {busy && <Loader2 className="animate-spin" />} Confirm request
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy} className="min-h-11">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="submit" className="min-h-11 w-full" disabled={available <= 0}>
                Request withdrawal
              </Button>
            )}
          </form>

          <div>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            {(state.data?.payouts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No withdrawals yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {state.data!.payouts.map((p) => {
                  const s = PAYOUT_STATUS[p.status] ?? { label: p.status, cls: 'bg-muted' };
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-semibold">{rupees(p.amount)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.method === 'UPI' ? p.upiId ?? 'UPI' : 'Bank account'} · {fmtDate(p.requestedAt)}
                          {p.reference ? ` · Ref ${p.reference}` : ''}
                        </div>
                        {p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', s.cls)}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
