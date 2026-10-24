'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface PendingRefund {
  refundId: string;
  method: string;
  amountPaise: number;
  destinationRef: string | null;
  requestedById: string;
  approvedById: string | null;
  reason: string | null;
  createdAt: string;
  orderCode: string | null;
}
type Mode = 'COMPLETE' | 'FAIL';

const inr = (p: number) => `₹${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;

/**
 * Pending Flavrly PG refunds (pg/refunds.ts): the money is in the restaurant's own bank account,
 * so a person makes the bank transfer. A different admin approves; the bank's refund reference
 * is entered on completion. Refunds are requested from the order page as before.
 */
export function RefundsPanel({ currentUserId, refunds }: { currentUserId: string; refunds: PendingRefund[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [f, setF] = useState({ bankReference: '', note: '', reason: '' });
  const [err, setErr] = useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/pg/refunds/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setErr(data.error || 'Action failed.'); return; }
      toast.success(ok);
      setOpen(null);
      setF({ bankReference: '', note: '', reason: '' });
      router.refresh();
    } catch { setErr('Network error.'); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold">Refunds to send</h2>
        <p className="text-xs text-muted-foreground">
          Send the money from your bank account, then record the bank&apos;s refund reference here. A second admin must approve each refund first.
        </p>
        {refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending refunds.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {refunds.map((r) => {
              const mine = r.requestedById === currentUserId;
              return (
                <li key={r.refundId} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{inr(r.amountPaise)} · order <span className="font-mono">{r.orderCode ?? '—'}</span></div>
                      <div className="text-xs text-muted-foreground break-all">
                        {r.method === 'WALLET' ? 'Wallet credit' : `Bank refund to ${r.destinationRef ?? 'customer (ask for UPI ID)'}`} · {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        {r.reason ? ` · ${r.reason}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={r.approvedById ? 'success' : 'warning'}>{r.approvedById ? 'Approved' : 'Needs approval'}</Badge>
                      {!r.approvedById && (
                        <Button size="sm" disabled={!!busy || mine} title={mine ? 'You requested this refund; another admin must approve it' : undefined}
                          onClick={() => act(r.refundId, { action: 'APPROVE' }, 'Refund approved.')}>
                          {busy === r.refundId ? <Loader2 className="size-4 animate-spin" /> : mine ? 'Needs another admin' : 'Approve'}
                        </Button>
                      )}
                      {r.approvedById && (
                        <Button size="sm" variant="outline" onClick={() => { setOpen({ id: r.refundId, mode: 'COMPLETE' }); setErr(null); }}>Mark sent</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setOpen({ id: r.refundId, mode: 'FAIL' }); setErr(null); }}>Mark failed</Button>
                    </div>
                  </div>
                  {open?.id === r.refundId && (
                    <div className="rounded-lg border bg-muted/40 p-3 grid gap-2 sm:grid-cols-2">
                      {open.mode === 'COMPLETE' ? (
                        <>
                          {r.method !== 'WALLET' && (
                            <div className="space-y-1">
                              <Label htmlFor={`ref-${r.refundId}`}>Bank refund reference (UTR / RRN)</Label>
                              <Input id={`ref-${r.refundId}`} autoComplete="off" value={f.bankReference} onChange={(e) => setF({ ...f, bankReference: e.target.value })} />
                            </div>
                          )}
                          <div className="space-y-1 sm:col-span-2">
                            <Label htmlFor={`note-${r.refundId}`}>Evidence (what you checked, where the proof is)</Label>
                            <Input id={`note-${r.refundId}`} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor={`fail-${r.refundId}`}>Why did the refund fail?</Label>
                          <Input id={`fail-${r.refundId}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
                        </div>
                      )}
                      {err && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{err}</p>}
                      <div className="sm:col-span-2 flex gap-2">
                        <Button size="sm" disabled={!!busy}
                          onClick={() => open.mode === 'COMPLETE'
                            ? act(r.refundId, { action: 'COMPLETE', bankReference: f.bankReference || undefined, note: f.note }, 'Refund recorded as sent.')
                            : act(r.refundId, { action: 'FAIL', reason: f.reason }, 'Refund marked failed.')}>
                          {busy === r.refundId ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
