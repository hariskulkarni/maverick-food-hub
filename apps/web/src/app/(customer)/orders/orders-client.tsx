'use client';
/**
 * Order-history page body — keeps the dialog state co-located with the rows
 * and the feedback banner. The server page hydrates `orders` (with feedback
 * + deliveredAt) so we can render the right "Give Feedback / View / Edit"
 * label without an extra round-trip.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { money, fmtDate } from '@/lib/utils';
import { ReorderButton } from './reorder-button';
import { FeedbackBanner } from './feedback-banner';
import { FeedbackDialog, type FeedbackLite } from './feedback-dialog';
import { MessageSquarePlus, MessageSquareText, Lock } from 'lucide-react';

export interface OrderRow {
  id: string;
  code: string;
  status: string;
  placedAt: string;
  total: number | string;
  paymentMethod: string;
  items: { id: string; name: string; quantity: number }[];
  deliveredAt: string | null;
  feedback: FeedbackLite | null;
}

const FEEDBACK_WINDOW_MS = 48 * 60 * 60 * 1000;

export function OrdersClient({ orders }: { orders: OrderRow[] }) {
  const [dialog, setDialog] = useState<
    | { order: OrderRow; existing: FeedbackLite | null; readOnly: boolean }
    | null
  >(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function openFor(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const readOnly = isWindowClosed(order);
    setDialog({ order, existing: order.feedback, readOnly });
  }

  return (
    <div className="container py-8">
      <h1 className="display text-2xl font-semibold mb-4">My orders</h1>

      <FeedbackBanner onOpen={openFor} refreshKey={refreshKey} />

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet. Browse the menu to place your first.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-5 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <Link href={`/orders/${o.id}`} className="font-semibold hover:text-primary">
                      {o.code}
                    </Link>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{fmtDate(o.placedAt)}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{money(o.total as any)}</div>
                  <div className="text-xs text-muted-foreground">{o.paymentMethod}</div>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button variant="outline" asChild>
                    <Link href={`/orders/${o.id}`}>Track</Link>
                  </Button>
                  <ReorderButton orderId={o.id} />
                  <FeedbackCTA order={o} onClick={() => openFor(o.id)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialog && (
        <FeedbackDialog
          order={{ id: dialog.order.id, code: dialog.order.code, deliveredAt: dialog.order.deliveredAt }}
          existing={dialog.existing}
          readOnly={dialog.readOnly}
          open={!!dialog}
          onOpenChange={(v) => {
            if (!v) setDialog(null);
          }}
          onSaved={() => {
            // Trigger a refetch of the banner; the row will pick up the new
            // feedback on the next server render (after the user navigates or
            // refreshes), which is fine for v1.
            setRefreshKey((k) => k + 1);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function FeedbackCTA({ order, onClick }: { order: OrderRow; onClick: () => void }) {
  if (order.status !== 'DELIVERED') return null;
  const closed = isWindowClosed(order);
  if (order.feedback) {
    if (closed) {
      return (
        <Button variant="ghost" size="sm" onClick={onClick}>
          <Lock className="size-4" /> Feedback closed
        </Button>
      );
    }
    return (
      <Button variant="secondary" size="sm" onClick={onClick}>
        <MessageSquareText className="size-4" /> Edit feedback
      </Button>
    );
  }
  if (closed) return null; // no feedback + window closed → nothing to do
  return (
    <Button size="sm" onClick={onClick}>
      <MessageSquarePlus className="size-4" /> Give feedback
    </Button>
  );
}

function isWindowClosed(order: OrderRow): boolean {
  if (order.feedback) {
    return new Date(order.feedback.windowEndsAt).getTime() < Date.now();
  }
  if (!order.deliveredAt) return order.status === 'DELIVERED' ? false : true;
  return new Date(order.deliveredAt).getTime() + FEEDBACK_WINDOW_MS < Date.now();
}
