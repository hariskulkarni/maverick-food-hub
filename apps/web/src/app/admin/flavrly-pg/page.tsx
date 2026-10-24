import Link from 'next/link';
import { prisma } from '@/server/db';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { ATTEMPT_BUCKETS, loadMerchantPgDashboard, type AttemptBucket } from '@/server/pg/dashboards';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatementUpload } from './statement-upload';
import { RefundsPanel } from './refunds-panel';

export const metadata = { title: 'Admin · Flavrly PG payments' };
export const dynamic = 'force-dynamic';

const BUCKET_LABEL: Record<AttemptBucket, string> = {
  awaiting: 'Awaiting payment',
  observed: 'Paid, awaiting bank verification',
  captured: 'Confirmed (bank-verified)',
  review: 'Review required',
  failed: 'Failed / expired',
  refunds: 'Refunds',
};
const STATE_HELP: Record<string, string> = {
  CREATED: 'Checkout created',
  CREATE_UNKNOWN: 'Checkout outcome unknown; being checked',
  AWAITING_PAYMENT: 'Waiting for the customer to pay',
  OBSERVED: 'Gateway saw the payment; waiting for the bank credit',
  BANK_VERIFIED: 'Bank credit found',
  CAPTURED: 'Confirmed by bank statement; order released',
  REVIEW_REQUIRED: 'Needs platform review',
  FAILED: 'Failed',
  EXPIRED: 'Expired before payment',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
};

const inr = (p: number | null | undefined) =>
  p == null ? '—' : `₹${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;
const when = (d: Date | null | undefined) => (d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—');

/** Restaurant ADMIN only (not KITCHEN): this restaurant's Flavrly PG payments and reconciliation. */
export default async function FlavrlyPgPaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; bucket?: string }> }) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) {
    return <div className="p-6 text-sm text-muted-foreground">Only a restaurant admin can view Flavrly PG payments.</div>;
  }
  const { restaurant } = gate;
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const bucket = sp.bucket && sp.bucket in ATTEMPT_BUCKETS ? (sp.bucket as AttemptBucket) : undefined;

  const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id }, select: { status: true } });
  const d = await loadMerchantPgDashboard(restaurant.id, { q, bucket });
  const verified = d.accounts.find((a) => a.status === 'VERIFIED');
  const istDay = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);
  const reportTo = istDay(Date.now());
  const reportFrom = istDay(Date.now() - 30 * 86_400_000);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header className="space-y-1">
        <h1 className="display text-2xl sm:text-3xl font-semibold">Flavrly PG payments</h1>
        <p className="text-sm text-muted-foreground">
          Direct UPI payments into your bank account. An order reaches your kitchen only after the credit is matched on your bank
          statement. A gateway "paid" signal alone is not enough.
        </p>
        <p className="text-xs">
          <Link href="/admin/settings/youpi" className="text-primary hover:underline">Feature status &amp; UPI ID requests</Link>
          {fr?.status ? <> · feature {fr.status.toLowerCase()}</> : <> · feature not requested</>}
        </p>
      </header>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Receiving account</h2>
          {d.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receiving account has been registered by the platform team yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.accounts.map((a) => (
                <li key={a.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono break-all">{a.vpa}</div>
                    <div className="text-xs text-muted-foreground">{a.legalEntityName} · {a.ifsc ?? '—'} · A/c ••••{a.accountLast4 ?? '—'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={a.status === 'VERIFIED' ? 'success' : a.status === 'REVOKED' ? 'destructive' : 'warning'}>{a.status.replace('_', ' ')}</Badge>
                    {a.disabledForNewAt && <Badge variant="warning">New payments paused</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!verified && d.accounts.length > 0 && (
            <p className="text-xs text-muted-foreground">New Flavrly PG checkouts stay off until the platform team verifies an account.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Health</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
            <div className="rounded-lg border p-3"><div className="text-[11px] uppercase text-muted-foreground">Last gateway webhook</div><div className="font-medium">{when(d.health.lastWebhookAt)}</div></div>
            <div className={`rounded-lg border p-3 ${d.health.staleObserved ? 'border-warning/50 bg-warning/10' : ''}`}><div className="text-[11px] uppercase text-muted-foreground">Paid, no bank credit &gt; 30 min</div><div className="font-medium">{d.health.staleObserved}</div></div>
            <div className="rounded-lg border p-3"><div className="text-[11px] uppercase text-muted-foreground">Order releases queued</div><div className="font-medium">{d.health.releasePending}</div></div>
            <div className={`rounded-lg border p-3 ${d.health.releaseDead ? 'border-destructive/50 bg-destructive/10' : ''}`}><div className="text-[11px] uppercase text-muted-foreground">Order releases failed</div><div className="font-medium">{d.health.releaseDead}</div></div>
          </div>
          {d.health.staleObserved > 0 && (
            <p className="text-xs text-muted-foreground">Upload today&apos;s bank statement below so these payments can be matched and the orders released.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Payments</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href={`?q=${encodeURIComponent(q)}`} className={`rounded-full border px-3 py-1 ${!bucket ? 'bg-primary/10 border-primary/30' : ''}`}>All</Link>
            {(Object.keys(BUCKET_LABEL) as AttemptBucket[]).map((b) => (
              <Link key={b} href={`?bucket=${b}&q=${encodeURIComponent(q)}`} className={`rounded-full border px-3 py-1 ${bucket === b ? 'bg-primary/10 border-primary/30' : ''}`}>
                {BUCKET_LABEL[b]} · {d.counts[b]}
              </Link>
            ))}
          </div>
          <form className="flex gap-2" action="">
            {bucket && <input type="hidden" name="bucket" value={bucket} />}
            <Input name="q" defaultValue={q} placeholder="Order code, UTR or amount (e.g. 250.00)" className="max-w-md" />
            <Button type="submit" variant="outline">Search</Button>
          </form>
          {d.attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Order</th><th className="pr-3">Amount</th><th className="pr-3">Status</th><th className="pr-3">UTR</th><th>Created</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.attempts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-3 font-mono">{a.orderCode ?? a.orderId.slice(0, 8)}</td>
                      <td className="pr-3">{inr(a.expectedAmountPaise)}</td>
                      <td className="pr-3"><span title={a.reviewReason ?? undefined}>{STATE_HELP[a.state] ?? a.state}</span></td>
                      <td className="pr-3 font-mono">{a.observedUtr ?? '—'}</td>
                      <td>{when(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Unmatched bank credits</h2>
          <p className="text-xs text-muted-foreground">Credits on your statement that no payment claims yet. They are never hidden; the platform team reviews them.</p>
          {d.unmatchedCredits.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.unmatchedCredits.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="font-medium">{inr(t.amountPaise)} · <span className="font-mono">{t.bankReference}</span></div>
                  <div className="text-xs text-muted-foreground break-all">{when(t.valueAt)} · {t.source.replace('_', ' ').toLowerCase()} · {t.status.toLowerCase()}{t.narrationRedacted ? ` · ${t.narrationRedacted}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Open exceptions</h2>
          {d.exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.exceptions.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{e.kind.replace(/_/g, ' ')}</Badge>
                  <Badge variant="muted">{e.status}</Badge>
                  <span>{inr(e.amountPaise)}</span>
                  {e.orderCode && <span className="font-mono text-xs">{e.orderCode}</span>}
                  <span className="text-xs text-muted-foreground">{when(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">The platform team resolves exceptions. Late or duplicate payments are refunded through them.</p>
        </CardContent>
      </Card>

      <RefundsPanel
        currentUserId={gate.session.user.id}
        refunds={d.refunds.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      />

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Export reconciliation (CSV)</h2>
          <p className="text-xs text-muted-foreground">
            One row per payment: expected, bank-confirmed, refunds, platform commission receivable. Money goes straight to your bank,
            so there is no gateway fee or Flavrly payout.
          </p>
          <form method="get" action="/api/admin/pg/report" className="flex flex-wrap items-end gap-2">
            <label className="text-xs">From<Input type="date" name="from" required defaultValue={reportFrom} /></label>
            <label className="text-xs">To<Input type="date" name="to" required defaultValue={reportTo} /></label>
            <Button type="submit" variant="outline">Download CSV</Button>
          </form>
        </CardContent>
      </Card>

      <StatementUpload
        accounts={d.accounts.map((a) => ({ id: a.id, label: `${a.vpa} (${a.status.toLowerCase()})` }))}
        imports={d.imports.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
      />
    </div>
  );
}
