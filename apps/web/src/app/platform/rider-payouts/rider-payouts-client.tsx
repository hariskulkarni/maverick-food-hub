'use client';
/**
 * Rider payouts explorer. Status-chip filter over the server-fetched rows;
 * REQUESTED / PROCESSING rows expose Mark paid / Mark failed actions that
 * PATCH /api/platform/rider-payouts/:id. Both actions confirm before firing.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { money } from '@/lib/utils';
import { Wallet, CheckCircle2, XCircle, Loader2, Phone } from 'lucide-react';

type PayoutStatus = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED';

interface PayoutRow {
  id: string;
  riderId: string;
  amount: number;
  status: PayoutStatus;
  method: string;
  upiId: string | null;
  reference: string | null;
  note: string | null;
  requestedAt: string;
  processedAt: string | null;
  rider: { name: string | null; phone: string | null };
}

const STATUS_FILTERS = ['ALL', 'REQUESTED', 'PROCESSING', 'PAID', 'FAILED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function RiderPayoutsClient({ initial }: { initial: PayoutRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [settle, setSettle] = useState<{ row: PayoutRow; target: 'PAID' | 'FAILED' } | null>(null);

  const rows = useMemo(
    () => (status === 'ALL' ? initial : initial.filter((r) => r.status === status)),
    [initial, status]
  );

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  status === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
                }`}
              >
                {s === 'ALL' ? 'All' : prettyStatus(s as PayoutStatus)}
              </button>
            ))}
            <span className="text-xs text-muted-foreground ml-3">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payouts" description="No rider withdrawal requests match this filter." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Rider</Th>
                    <Th align="right">Amount</Th>
                    <Th>Method</Th>
                    <Th>Status</Th>
                    <Th>Requested</Th>
                    <Th>Processed</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs truncate max-w-[160px]">{r.rider.name ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.rider.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div>{r.method}</div>
                        {r.upiId && <div className="text-[11px] text-muted-foreground font-mono">{r.upiId}</div>}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(r.requestedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.processedAt ? new Date(r.processedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(r.status === 'REQUESTED' || r.status === 'PROCESSING') ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="success" onClick={() => setSettle({ row: r, target: 'PAID' })}>
                              <CheckCircle2 className="size-3.5" /> Paid
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="text-destructive border-destructive/40 hover:bg-destructive/10"
                              onClick={() => setSettle({ row: r, target: 'FAILED' })}
                            >
                              <XCircle className="size-3.5" /> Failed
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {settle && (
        <SettleDialog
          row={settle.row}
          target={settle.target}
          onClose={() => setSettle(null)}
          onDone={() => { setSettle(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function SettleDialog({ row, target, onClose, onDone }: {
  row: PayoutRow; target: 'PAID' | 'FAILED'; onClose: () => void; onDone: () => void;
}) {
  const [reference, setReference] = useState(row.reference ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/rider-payouts/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target, reference: reference.trim() || undefined, note: note.trim() || undefined })
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success(`Payout marked ${target.toLowerCase()}`);
      onDone();
    } catch (e) {
      toast.error('Failed to settle: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark payout {target.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {money(row.amount)} to {row.rider.name ?? row.rider.phone ?? 'rider'} via {row.method}
            {row.upiId ? ` (${row.upiId})` : ''}. This is final and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="size-3.5" /> <span className="font-mono">{row.rider.phone}</span>
          </div>
          <div>
            <Label>Processor reference {target === 'PAID' && <span className="text-muted-foreground text-xs">(txn id)</span>}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UPI-2026-XXXX" />
          </div>
          <div>
            <Label>Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={target === 'FAILED' ? 'Why did it fail?' : 'Internal note'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={target === 'PAID' ? 'success' : 'destructive'}
            onClick={submit}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Confirm {target.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function StatusPill({ status }: { status: PayoutStatus }) {
  const map: Record<PayoutStatus, { variant: 'default' | 'success' | 'warning' | 'destructive'; label: string }> = {
    REQUESTED:  { variant: 'warning',     label: 'Requested' },
    PROCESSING: { variant: 'default',     label: 'Processing' },
    PAID:       { variant: 'success',     label: 'Paid' },
    FAILED:     { variant: 'destructive', label: 'Failed' }
  };
  const x = map[status];
  return <Badge variant={x.variant} className="text-[10px]">{x.label}</Badge>;
}

function prettyStatus(s: PayoutStatus): string {
  return { REQUESTED: 'Requested', PROCESSING: 'Processing', PAID: 'Paid', FAILED: 'Failed' }[s];
}
