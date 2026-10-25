'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { Jsonified, PlatformPgOps } from '@/server/pg/dashboards';
import { ConfirmActionDialog, paiseToRupees, rupeesToPaise, type ActionSpec } from '@/components/pg/confirm-action-dialog';

type Ops = Jsonified<PlatformPgOps>;

const inr = (p: number | null | undefined) =>
  p == null ? '—' : `₹${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const age = (sec: number) => (sec < 120 ? `${sec}s` : sec < 7200 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);
const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm';

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: { error?: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function Tile({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? 'border-warning/50 bg-warning/10' : ''}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export function OpsClient({ currentUserId, ops }: { currentUserId: string; ops: Ops }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [resolveStatus, setResolveStatus] = useState<'RESOLVED' | 'ACKNOWLEDGED'>('RESOLVED');
  const [entry, setEntry] = useState({ receivingAccountId: '', direction: 'CREDIT', amount: '', bankReference: '', valueAt: '', narration: '' });
  const [entryErr, setEntryErr] = useState<string | null>(null);
  const [prop, setProp] = useState({ attemptId: '', bankTransactionId: '', reason: '' });
  const [propErr, setPropErr] = useState<string | null>(null);
  const [action, setAction] = useState<ActionSpec | null>(null);

  /** POST for a dialog: error message (dialog stays open) or null after success + refresh. */
  async function act(url: string, body: unknown, ok: string): Promise<string | null> {
    const r = await postJson(url, body);
    if (!r.ok) return r.data.error || 'Action failed.';
    toast.success(ok);
    router.refresh();
    return null;
  }

  type Exc = Ops['exceptions'][number];
  const refundKindOf = (e: Exc): 'ORDER' | 'LATE_PAYMENT' | 'OVERCOLLECTION' | null => {
    if (e.kind === 'LATE_PAYMENT' || e.kind === 'OVERCOLLECTION') return e.kind;
    if (e.kind === 'RELEASE_HELD' && e.status === 'ACKNOWLEDGED') {
      return (e.detail as { reason?: string } | null)?.reason === 'late_payment_accepted' ? 'LATE_PAYMENT' : 'ORDER';
    }
    return null;
  };
  const refundSpec = (e: Exc, kind: 'ORDER' | 'LATE_PAYMENT' | 'OVERCOLLECTION'): ActionSpec => ({
    title: `Start a ${kind === 'ORDER' ? 'order' : kind === 'LATE_PAYMENT' ? 'late-payment' : 'overcollection'} refund`,
    body: (
      <>
        <p>This records a manual bank refund request for the customer of {e.restaurantName ?? 'this restaurant'}. Nothing is sent now.</p>
        <p>A different person approves it on the restaurant&apos;s Flavrly PG page, the restaurant transfers the money from its own bank account, and the bank&apos;s refund reference (UTR/RRN) is recorded to complete it. The amount cannot exceed the bank-confirmed money.</p>
      </>
    ),
    confirmLabel: 'Request refund',
    fields: [
      { name: 'amount', label: 'Amount (₹)', kind: 'amount', required: true, defaultValue: paiseToRupees(e.amountPaise) },
      { name: 'reason', label: 'Reason', kind: 'textarea', required: true, defaultValue: `Refund for ${e.kind} exception ${e.id}` },
      { name: 'destinationRef', label: 'Customer UPI ID / account (masked, optional)', placeholder: 'e.g. r***@okbank' },
    ],
    onConfirm: async (v) => {
      const amountPaise = rupeesToPaise(v.amount);
      if (!amountPaise) return 'Enter an amount like 250.00.';
      return act('/api/platform/youpi/refunds', { attemptId: e.attemptId, kind, amountPaise, reason: v.reason, destinationRef: v.destinationRef || undefined, idempotencyKey: `ops-${e.id}-${kind}-${amountPaise}` }, 'Refund requested; it now needs a second approver.');
    },
  });
  const acceptLateSpec = (e: Exc): ActionSpec => ({
    title: 'Propose accepting this late payment',
    body: (
      <>
        <p>The customer&apos;s money arrived after the payment window closed. This asks a <strong>second super admin</strong> to approve treating it as the order&apos;s payment.</p>
        <p>After approval the <strong>restaurant must confirm</strong> it can still prepare the order; only then is the payment captured and the order sent to the kitchen (never auto-accepted). Not possible for a cancelled or already-paid order: refund instead.</p>
      </>
    ),
    confirmLabel: 'Propose',
    fields: [{ name: 'reason', label: 'Why (evidence, customer contact)', kind: 'textarea', required: true }],
    onConfirm: (v) => act('/api/platform/youpi/ops-actions', { action: 'LATE_ACCEPT', bankTransactionId: e.bankTransactionId, reason: v.reason }, 'Proposal recorded; a second super admin must approve.'),
  });
  const voidSpec = (e: Exc): ActionSpec => ({
    title: 'Propose voiding this payment attempt',
    body: (
      <>
        <p>Asks a <strong>second super admin</strong> to close attempt <span className="font-mono">{e.attemptId}</span> so the customer can start a new payment.</p>
        <p>Allowed only when there is <strong>no payment evidence</strong>: no gateway or observer observation, no UTR, no signed amount, no bank credit and no gateway success. The server checks again at approval and refuses otherwise. A payment that still arrives later is booked as a late payment.</p>
      </>
    ),
    confirmLabel: 'Propose void',
    destructive: true,
    fields: [{ name: 'reason', label: 'Why (what was checked on the gateway)', kind: 'textarea', required: true }],
    onConfirm: (v) => act('/api/platform/youpi/ops-actions', { action: 'ATTEMPT_VOID', attemptId: e.attemptId, reason: v.reason }, 'Void proposed; a second super admin must approve.'),
  });
  const reversalSpec: ActionSpec = {
    title: 'Propose a bank reversal',
    body: (
      <>
        <p>Use when the bank reversed (charged back) a credit. Asks a <strong>second super admin</strong> to book it.</p>
        <p>The credit is marked REVERSED and its allocation is released. The order and payment are <strong>not</strong> changed automatically; a REVERSAL exception is opened for follow-up (recovery or refund decision by the owner).</p>
      </>
    ),
    confirmLabel: 'Propose reversal',
    destructive: true,
    fields: [
      { name: 'bankTransactionId', label: 'Bank transaction id', required: true },
      { name: 'reason', label: 'Bank evidence (reversal reference, date)', kind: 'textarea', required: true },
    ],
    onConfirm: (v) => act('/api/platform/youpi/ops-actions', { action: 'REVERSAL', bankTransactionId: v.bankTransactionId.trim(), reason: v.reason }, 'Reversal proposed; a second super admin must approve.'),
  };
  const ACTION_LABEL: Record<string, string> = { LATE_ACCEPT: 'Accept late payment', ATTEMPT_VOID: 'Void attempt', REVERSAL: 'Bank reversal' };
  const APPROVE_COPY: Record<string, string> = {
    LATE_ACCEPT: 'Approving sends this order to the restaurant for confirmation. The payment is captured only when the restaurant confirms.',
    ATTEMPT_VOID: 'Approving closes the attempt (if it still has no payment evidence) and lets the customer pay again.',
    REVERSAL: 'Approving marks the credit REVERSED and opens a REVERSAL exception. The order is not changed.',
  };

  async function run(key: string, url: string, body: unknown, ok: string, onErr?: (m: string) => void) {
    setBusy(key);
    try {
      const r = await postJson(url, body);
      if (!r.ok) {
        const msg = r.data.error || 'Action failed.';
        if (onErr) onErr(msg);
        else toast.error(msg);
        return false;
      }
      toast.success(ok);
      router.refresh();
      return true;
    } catch {
      toast.error('Network error.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const stale30 = Object.values(ops.stale.over30m).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="space-y-6">
      <ConfirmActionDialog spec={action} onClose={() => setAction(null)} />
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Health</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Webhook inbox pending" value={ops.inbox.pending} warn={ops.inbox.pending > 20} />
            <Tile label="Webhook oldest pending" value={age(ops.inbox.oldestPendingAgeSec)} warn={ops.inbox.oldestPendingAgeSec > 600} />
            <Tile label="Webhook retrying" value={ops.inbox.retrying} warn={ops.inbox.retrying > 0} />
            <Tile label="Webhook dead letters" value={ops.inbox.deadLettered} warn={ops.inbox.deadLettered > 0} />
            <Tile label="Outbox backlog" value={ops.outbox.backlog} warn={ops.outbox.backlog > 20} />
            <Tile label="Outbox oldest pending" value={age(ops.outbox.oldestPendingAgeSec)} warn={ops.outbox.oldestPendingAgeSec > 600} />
            <Tile label="Outbox retrying" value={ops.outbox.retrying} warn={ops.outbox.retrying > 0} />
            <Tile label="Outbox dead" value={ops.outbox.dead} warn={ops.outbox.dead > 0} />
            <Tile label="Pending > 30 min" value={stale30} warn={stale30 > 0} />
            <Tile label="Pending > 24 h" value={ops.stale.over24h} warn={ops.stale.over24h > 0} />
            <Tile label="Unmatched bank credits" value={ops.unmatchedCredits} warn={ops.unmatchedCredits > 0} />
            <Tile label="Open exceptions" value={ops.exceptions.length} warn={ops.exceptions.length > 0} />
          </div>
          {stale30 > 0 && (
            <p className="text-xs text-muted-foreground">
              Stale by state: {Object.entries(ops.stale.over30m).map(([s, n]) => `${s} ${n}`).join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Exception queue (all restaurants)</h2>
          {ops.exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open exceptions.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ops.exceptions.map((e) => (
                <li key={e.id} className="py-3 space-y-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning">{e.kind}</Badge>
                        <Badge variant="muted">{e.status}</Badge>
                        <span className="font-medium">{e.restaurantName ?? 'Unknown restaurant'}</span>
                        <span>{inr(e.amountPaise)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground break-all">
                        {when(e.createdAt)} · attempt {e.attemptId ?? '—'} · bank txn {e.bankTransactionId ?? '—'} · order {e.orderId ?? '—'}
                      </div>
                      {e.detail != null && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-[11px]">{JSON.stringify(e.detail)}</pre>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {e.attemptId && refundKindOf(e) && (
                        <Button size="sm" variant="outline" onClick={() => setAction(refundSpec(e, refundKindOf(e)!))}>Start refund…</Button>
                      )}
                      {e.kind === 'LATE_PAYMENT' && e.bankTransactionId && (
                        <Button size="sm" variant="outline" onClick={() => setAction(acceptLateSpec(e))}>Accept late payment…</Button>
                      )}
                      {e.attemptId && ['CREATE_UNKNOWN', 'RECEIVER_MISMATCH', 'STALE_PENDING'].includes(e.kind) && (
                        <Button size="sm" variant="outline" onClick={() => setAction(voidSpec(e))}>Void attempt…</Button>
                      )}
                      {e.attemptId && e.bankTransactionId && e.kind !== 'LATE_PAYMENT' && e.kind !== 'OVERCOLLECTION' && (
                        <Button size="sm" variant="outline" onClick={() => setProp({ attemptId: e.attemptId!, bankTransactionId: e.bankTransactionId!, reason: `Resolves ${e.kind} exception ${e.id}` })}>
                          Propose allocation
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setResolveFor(e.id); setResolution(''); }}>Resolve…</Button>
                    </div>
                  </div>
                  {resolveFor === e.id && (
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                      <Label htmlFor={`res-${e.id}`}>Resolution note (what was done, refund ref, etc.)</Label>
                      <Textarea id={`res-${e.id}`} value={resolution} onChange={(ev) => setResolution(ev.target.value)} />
                      <div className="flex flex-wrap items-center gap-2">
                        <select className={`${selectCls} w-auto`} value={resolveStatus} onChange={(ev) => setResolveStatus(ev.target.value as 'RESOLVED' | 'ACKNOWLEDGED')}>
                          <option value="RESOLVED">Resolve</option>
                          <option value="ACKNOWLEDGED">Acknowledge only</option>
                        </select>
                        <Button size="sm" disabled={!!busy || !resolution.trim()}
                          onClick={async () => { if (await run(`res-${e.id}`, `/api/platform/youpi/exceptions/${e.id}/resolve`, { resolution, status: resolveStatus }, 'Exception updated.')) setResolveFor(null); }}>
                          {busy === `res-${e.id}` ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResolveFor(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Dual-control actions awaiting a second super admin</h2>
            <Button size="sm" variant="outline" onClick={() => setAction(reversalSpec)}>Propose bank reversal…</Button>
          </div>
          {ops.opsProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ops.opsProposals.map((p) => {
                const mine = p.proposedById === currentUserId;
                return (
                  <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{ACTION_LABEL[p.action] ?? p.action} · {p.restaurantName ?? '—'} · {inr(p.amountPaise)}</div>
                      <div className="text-xs text-muted-foreground break-all">
                        {p.attemptId ? `attempt ${p.attemptId} · ` : ''}{p.bankTransactionId ? `bank txn ${p.bankTransactionId} · ` : ''}{when(p.createdAt)} · {p.reason}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={mine} title={mine ? 'You proposed this; a different super admin must approve it' : undefined}
                        onClick={() => setAction({
                          title: `Approve: ${ACTION_LABEL[p.action] ?? p.action}`,
                          body: <><p>{APPROVE_COPY[p.action]}</p><p>Requested reason: {p.reason}</p><p>Your approval is recorded with your name.</p></>,
                          confirmLabel: 'Approve',
                          destructive: p.action !== 'LATE_ACCEPT',
                          onConfirm: () => act(`/api/platform/youpi/ops-actions/${p.id}`, { decision: 'APPROVE' }, 'Approved.'),
                        })}>
                        {mine ? 'Needs another approver' : 'Approve…'}
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => setAction({
                          title: `Reject: ${ACTION_LABEL[p.action] ?? p.action}`,
                          body: <p>Nothing is changed. The proposal is closed{mine ? ' (withdrawn by you)' : ''}.</p>,
                          confirmLabel: 'Reject',
                          fields: [{ name: 'note', label: 'Why', kind: 'textarea', required: true }],
                          onConfirm: (v) => act(`/api/platform/youpi/ops-actions/${p.id}`, { decision: 'REJECT', note: v.note }, 'Proposal rejected.'),
                        })}>
                        {mine ? 'Withdraw…' : 'Reject…'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold">Manual bank entry (dual control)</h2>
          <p className="text-xs text-muted-foreground">Enter a credit exactly as it appears on the bank statement. It stays pending until a different super admin approves it.</p>
          <form className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (ev) => {
              ev.preventDefault();
              setEntryErr(null);
              if (await run('entry', '/api/platform/youpi/bank-entries', entry, 'Entry saved; awaiting a second approver.', setEntryErr)) {
                setEntry({ ...entry, amount: '', bankReference: '', valueAt: '', narration: '' });
              }
            }}>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="me-acc">Receiving account</Label>
              <select id="me-acc" required className={selectCls} value={entry.receivingAccountId} onChange={(ev) => setEntry({ ...entry, receivingAccountId: ev.target.value })}>
                <option value="">Choose…</option>
                {ops.accounts.map((a) => <option key={a.id} value={a.id}>{a.restaurantName} · {a.vpa} ({a.status.toLowerCase()})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-dir">Direction</Label>
              <select id="me-dir" className={selectCls} value={entry.direction} onChange={(ev) => setEntry({ ...entry, direction: ev.target.value })}>
                <option value="CREDIT">Credit</option>
                <option value="DEBIT">Debit</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-amt">Amount (₹)</Label>
              <Input id="me-amt" required inputMode="decimal" placeholder="250.00" value={entry.amount} onChange={(ev) => setEntry({ ...entry, amount: ev.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-ref">Bank reference (UTR / RRN)</Label>
              <Input id="me-ref" required autoComplete="off" value={entry.bankReference} onChange={(ev) => setEntry({ ...entry, bankReference: ev.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-at">Value date &amp; time (IST)</Label>
              <Input id="me-at" required type="datetime-local" value={entry.valueAt} onChange={(ev) => setEntry({ ...entry, valueAt: ev.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="me-nar">Narration (optional; account numbers and UPI IDs are masked)</Label>
              <Input id="me-nar" value={entry.narration} onChange={(ev) => setEntry({ ...entry, narration: ev.target.value })} />
            </div>
            {entryErr && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{entryErr}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!!busy}>{busy === 'entry' ? <Loader2 className="size-4 animate-spin" /> : 'Save entry'}</Button>
            </div>
          </form>
          <h3 className="text-sm font-semibold">Awaiting approval</h3>
          {ops.pendingEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing pending.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ops.pendingEntries.map((t) => {
                const mine = t.enteredById === currentUserId;
                return (
                  <li key={t.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{t.restaurantName} · {t.direction} {inr(t.amountPaise)}</div>
                      <div className="text-xs text-muted-foreground break-all">ref <span className="font-mono">{t.bankReference}</span> · {when(t.valueAt)} · entered {when(t.createdAt)}{t.narrationRedacted ? ` · ${t.narrationRedacted}` : ''}</div>
                    </div>
                    <Button size="sm" disabled={!!busy || mine} title={mine ? 'You entered this; a different super admin must approve it' : undefined}
                      onClick={() => run(`ap-${t.id}`, `/api/platform/youpi/bank-entries/${t.id}/approve`, {}, 'Entry approved.')}>
                      {busy === `ap-${t.id}` ? <Loader2 className="size-4 animate-spin" /> : mine ? 'Needs another approver' : 'Approve'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold">Manual allocation (dual control)</h2>
          <p className="text-xs text-muted-foreground">
            Use only when the UTR is missing or ambiguous and you have other evidence. The engine still requires the same receiving account,
            a credit, INR and the exact amount. A different super admin approves.
          </p>
          <form className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (ev) => {
              ev.preventDefault();
              setPropErr(null);
              if (await run('prop', '/api/platform/youpi/allocations', prop, 'Proposal recorded; awaiting a second approver.', setPropErr)) {
                setProp({ attemptId: '', bankTransactionId: '', reason: '' });
              }
            }}>
            <div className="space-y-1">
              <Label htmlFor="pa-att">Payment attempt id</Label>
              <Input id="pa-att" required autoComplete="off" value={prop.attemptId} onChange={(ev) => setProp({ ...prop, attemptId: ev.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pa-txn">Bank transaction id</Label>
              <Input id="pa-txn" required autoComplete="off" value={prop.bankTransactionId} onChange={(ev) => setProp({ ...prop, bankTransactionId: ev.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pa-reason">Evidence / reason</Label>
              <Textarea id="pa-reason" required value={prop.reason} onChange={(ev) => setProp({ ...prop, reason: ev.target.value })} />
            </div>
            {propErr && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{propErr}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!!busy}>{busy === 'prop' ? <Loader2 className="size-4 animate-spin" /> : 'Propose'}</Button>
            </div>
          </form>
          <h3 className="text-sm font-semibold">Proposals (last 30 days)</h3>
          {ops.proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposals.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ops.proposals.map((p) => {
                const mine = p.proposedById === currentUserId;
                const open = !p.decision && (p.bankTxnStatus === 'UNMATCHED' || p.bankTxnStatus === 'REVIEW_REQUIRED');
                return (
                  <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{inr(p.amountPaise)} · bank txn {p.bankTxnStatus ?? '—'}{p.decision ? ` · ${p.decision.toLowerCase()}` : ''}</div>
                      <div className="text-xs text-muted-foreground break-all">attempt {p.attemptId} · txn {p.bankTransactionId} · {when(p.createdAt)} · {p.reason}</div>
                    </div>
                    <Button size="sm" disabled={!!busy || mine || !open}
                      title={mine ? 'You proposed this; a different super admin must approve it' : !open ? 'Bank transaction is no longer open' : undefined}
                      onClick={() => run(`pp-${p.id}`, `/api/platform/youpi/allocations/${p.id}/approve`, {}, 'Allocation approved.')}>
                      {busy === `pp-${p.id}` ? <Loader2 className="size-4 animate-spin" /> : !open ? 'Closed' : mine ? 'Needs another approver' : 'Approve'}
                    </Button>
                    {open && (
                      <Button size="sm" variant="ghost"
                        onClick={() => setAction({
                          title: 'Reject manual allocation proposal',
                          body: <p>Nothing is allocated. The proposal is closed and cannot be approved later{mine ? ' (withdrawn by you)' : ''}.</p>,
                          confirmLabel: 'Reject',
                          fields: [{ name: 'reason', label: 'Why', kind: 'textarea', required: true }],
                          onConfirm: (v) => act(`/api/platform/youpi/allocations/${p.id}/reject`, { reason: v.reason }, 'Proposal rejected.'),
                        })}>
                        {mine ? 'Withdraw…' : 'Reject…'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Dead letters</h2>
          <p className="text-xs text-muted-foreground">Requeue only after fixing the cause in the error. Requeueing moves no money: an order release still needs bank-captured money and a webhook only records an observation.</p>
          <h3 className="text-sm font-semibold">Outbox</h3>
          {ops.deadOutbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ops.deadOutbox.map((o) => (
                <li key={o.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{o.topic} · {o.aggregateId} · {o.attempts} attempts</div>
                    <div className="text-xs text-muted-foreground break-all">{when(o.createdAt)} · {o.lastError ?? ''}</div>
                  </div>
                  <Button size="sm" variant="outline"
                    onClick={() => setAction({
                      title: `Requeue ${o.topic}`,
                      body: <p>The message is retried from attempt 0 on the next worker tick. Your name is recorded.</p>,
                      confirmLabel: 'Requeue',
                      onConfirm: () => act('/api/platform/youpi/dead-letters', { type: 'outbox', id: o.id }, 'Requeued.'),
                    })}>
                    Requeue…
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-sm font-semibold">Gateway webhooks</h3>
          {ops.deadInbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ops.deadInbox.map((w) => (
                <li key={w.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{w.eventType} · {w.providerEventId ?? w.id} · {w.attempts} attempts</div>
                    <div className="text-xs text-muted-foreground break-all">{when(w.createdAt)} · {w.error ?? ''}</div>
                  </div>
                  <Button size="sm" variant="outline" disabled={w.redacted} title={w.redacted ? 'Body already redacted by retention; cannot be replayed' : undefined}
                    onClick={() => setAction({
                      title: 'Requeue gateway webhook',
                      body: <p>The stored, signature-verified webhook is processed again on the next worker tick. It can only record an observation; it never captures money. Your name is recorded.</p>,
                      confirmLabel: 'Requeue',
                      onConfirm: () => act('/api/platform/youpi/dead-letters', { type: 'webhook', id: w.id }, 'Requeued.'),
                    })}>
                    {w.redacted ? 'Redacted' : 'Requeue…'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
