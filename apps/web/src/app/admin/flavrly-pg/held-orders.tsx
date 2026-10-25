'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmActionDialog, type ActionSpec } from '@/components/pg/confirm-action-dialog';

export interface HeldOrderRow {
  exceptionId: string;
  orderCode: string | null;
  amountPaise: number | null;
  reason: 'stale_release' | 'late_payment_accepted';
  createdAt: string;
}

const inr = (p: number | null) => (p == null ? '—' : `₹${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Restaurant ADMIN: paid orders that reach the kitchen only after this restaurant confirms them. */
export function HeldOrders({ rows }: { rows: HeldOrderRow[] }) {
  const router = useRouter();
  const [action, setAction] = useState<ActionSpec | null>(null);
  if (rows.length === 0) return null;

  const decide = (r: HeldOrderRow, decision: 'CONFIRM' | 'DECLINE') => async (v: Record<string, string>) => {
    const res = await fetch(`/api/admin/pg/held-orders/${r.exceptionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note: v.note || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data as { error?: string }).error || 'Action failed.';
    toast.success(decision === 'CONFIRM' ? 'Order confirmed and sent to the kitchen.' : 'Order declined; the customer will be refunded.');
    router.refresh();
    return null;
  };

  return (
    <Card className="border-warning/50">
      <CardContent className="p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold">Paid orders waiting for your confirmation</h2>
        <p className="text-sm text-muted-foreground">
          The customer&apos;s payment is confirmed by your bank statement, but the order is old (or the payment arrived late), so it was not sent to the
          kitchen automatically. Confirm only if you can still prepare it now. If you decline, the order is cancelled and the customer must be refunded.
        </p>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.exceptionId} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Order {r.orderCode ?? '—'}</span>
                  <span>{inr(r.amountPaise)}</span>
                  <Badge variant="warning">{r.reason === 'late_payment_accepted' ? 'Late payment accepted by platform' : 'Paid long after ordering'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">Waiting since {when(r.createdAt)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm"
                  onClick={() => setAction({
                    title: `Confirm order ${r.orderCode ?? ''}`,
                    body: (
                      <>
                        <p>The order goes to your kitchen now as a new order. It is <strong>not</strong> auto-accepted: accept it on the orders board as usual.</p>
                        {r.reason === 'late_payment_accepted' && <p>The late payment is booked as this order&apos;s payment when you confirm.</p>}
                      </>
                    ),
                    confirmLabel: 'Confirm and send to kitchen',
                    onConfirm: decide(r, 'CONFIRM'),
                  })}>
                  Confirm…
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => setAction({
                    title: `Decline order ${r.orderCode ?? ''}`,
                    body: (
                      <>
                        <p>The order is cancelled and will not be prepared. The customer&apos;s money is in your bank account, so a refund must be sent from it.</p>
                        <p>The platform team starts the refund; a second person approves it and the bank&apos;s refund reference is recorded on this page.</p>
                      </>
                    ),
                    confirmLabel: 'Decline and cancel',
                    destructive: true,
                    fields: [{ name: 'note', label: 'Reason (shown to the platform team)', kind: 'textarea', required: true }],
                    onConfirm: decide(r, 'DECLINE'),
                  })}>
                  Decline…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
