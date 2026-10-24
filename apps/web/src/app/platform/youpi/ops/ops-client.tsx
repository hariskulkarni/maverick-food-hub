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

type Ops = Jsonified<PlatformPgOps>;

const inr = (p: number | null | undefined) =>
  p == null ? '—' : `₹${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const age = (sec: number) => (sec < 120 ? `${sec}s` : sec < 7200 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`);
const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm';

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
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
                      {e.attemptId && e.bankTransactionId && (
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
                const open = p.bankTxnStatus === 'UNMATCHED' || p.bankTxnStatus === 'REVIEW_REQUIRED';
                return (
                  <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{inr(p.amountPaise)} · bank txn {p.bankTxnStatus ?? '—'}</div>
                      <div className="text-xs text-muted-foreground break-all">attempt {p.attemptId} · txn {p.bankTransactionId} · {when(p.createdAt)} · {p.reason}</div>
                    </div>
                    <Button size="sm" disabled={!!busy || mine || !open}
                      title={mine ? 'You proposed this; a different super admin must approve it' : !open ? 'Bank transaction is no longer open' : undefined}
                      onClick={() => run(`pp-${p.id}`, `/api/platform/youpi/allocations/${p.id}/approve`, {}, 'Allocation approved.')}>
                      {busy === `pp-${p.id}` ? <Loader2 className="size-4 animate-spin" /> : !open ? 'Closed' : mine ? 'Needs another approver' : 'Approve'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Dead outbox messages</h2>
          {ops.deadOutbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ops.deadOutbox.map((o) => (
                <li key={o.id} className="py-2">
                  <div className="font-medium">{o.topic} · {o.aggregateId} · {o.attempts} attempts</div>
                  <div className="text-xs text-muted-foreground break-all">{when(o.createdAt)} · {o.lastError ?? ''}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
