import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { money, STATUS_LABELS } from '@/lib/utils';
import { Phone, Star, MessageSquare } from 'lucide-react';
import { findFeedbackByOrder, visibleForRole } from '@/server/feedback';
import { accessibleOrderScope } from '@/server/tenancy';
import { STAFF_USER_SELECT } from '@/server/staff-orders';
import { itemOptions, FULFILLMENT_LABEL } from '@/lib/kot';
import { formatIst } from '@/lib/ist';

const TAG_LABEL: Record<string, string> = {
  MISSING_ITEM: 'Missing item', WRONG_ITEM: 'Wrong item', COLD_FOOD: 'Cold food',
  PACKAGING_ISSUE: 'Packaging issue', FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery', RIDER_BEHAVIOR: 'Rider behaviour'
};

export const metadata = { title: 'Admin · Order' };

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Tenant scope: only orders in a restaurant this account can operate (the
  // lookup was by bare id, so any admin could open any tenant's order).
  const scope = await accessibleOrderScope();
  if (!scope) return notFound();
  const o = await prisma.order.findFirst({
    where: { id, branchId: { in: scope.branchIds } },
    include: {
      customer: { select: STAFF_USER_SELECT },
      items: true,
      address: true,
      branch: true,
      payments: true,
      statusEvents: { orderBy: { createdAt: 'asc' } },
      assignment: { include: { rider: { include: { user: { select: STAFF_USER_SELECT } } } } },
      reservation: { select: { table: { select: { name: true } } } },
    }
  });
  if (!o) return notFound();

  // Customer feedback — projected through the ADMIN role gate so delivery
  // rating and rider-related tags never reach this page.
  const rawFeedback = await findFeedbackByOrder(id);
  const feedback = rawFeedback ? visibleForRole(rawFeedback, 'ADMIN') : null;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="display text-2xl font-semibold flex items-center gap-3">{o.code} <OrderStatusBadge status={o.status} /></h1>
          <p className="text-sm text-muted-foreground">
            {formatIst(o.placedAt)} · {FULFILLMENT_LABEL[o.fulfillmentType] ?? o.fulfillmentType}
            {o.reservation?.table?.name ? ` · Table ${o.reservation.table.name}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/admin/orders">← All orders</Link></Button>
          <Button variant="outline" asChild><a href={`/api/admin/orders/${o.id}/kot`} target="_blank" rel="noreferrer">KOT</a></Button>
          <Button variant="outline" asChild><a href={`/api/admin/orders/${o.id}/invoice.pdf`} target="_blank" rel="noreferrer">Invoice PDF</a></Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2"><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Items</h3>
          <ul className="text-sm divide-y">
            {o.items.map((i) => (
              <li key={i.id} className="flex justify-between py-2">
                <span>
                  {i.quantity}× {i.name}
                  {i.isFreebie && <Badge variant="muted" className="ml-2">Free gift</Badge>}
                  {itemOptions(i) && <span className="block text-xs font-medium">{itemOptions(i)}</span>}
                  {i.notes ? <em className="block text-xs text-muted-foreground">{i.notes}</em> : null}
                </span>
                <span>{money(Number(i.unitPrice) * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Row label="Subtotal" value={money(o.subtotal as any)} />
            <Row label="Tax" value={money(o.taxAmount as any)} />
            <Row label="Delivery" value={money(o.deliveryFee as any)} />
            {Number(o.discountAmount) > 0 && <Row label="Discount" value={'−' + money(o.discountAmount as any)} />}
            <Row label="Total" value={money(o.total as any)} bold />
          </div>
        </CardContent></Card>
        <div className="space-y-4">
          <Card><CardContent className="p-5">
            <h3 className="font-semibold mb-2">Customer</h3>
            <div>{o.customer.name}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1"><Phone className="size-3" /> {o.customer.phone}</div>
            {o.address && <p className="mt-2 text-sm">{o.address.line1}, {o.address.city} {o.address.postalCode}</p>}
          </CardContent></Card>
          {o.assignment?.rider && (
            <Card><CardContent className="p-5">
              <h3 className="font-semibold mb-2">Rider</h3>
              <div>{o.assignment.rider.user.name}</div>
              <div className="text-sm text-muted-foreground">{o.assignment.rider.vehicleNumber}</div>
            </CardContent></Card>
          )}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold mb-2">Status timeline</h3>
            <ul className="text-sm space-y-1">
              {o.statusEvents.map((e, i) => (
                <li key={i} className="flex justify-between"><span>{STATUS_LABELS[e.status]}</span><span className="text-muted-foreground">{formatIst(new Date(e.createdAt), { hour: '2-digit', minute: '2-digit' })}</span></li>
              ))}
            </ul>
          </CardContent></Card>
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><MessageSquare className="size-4" /> Customer feedback</h3>
              {!feedback ? (
                <p className="text-sm text-muted-foreground">No feedback yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <Rating label="Food" value={feedback.foodRating} />
                  <Rating label="Overall" value={feedback.overallRating} />
                  {feedback.issueTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {feedback.issueTags.map((t) => (
                        <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t}</Badge>
                      ))}
                    </div>
                  )}
                  {feedback.comment && (
                    <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2 mt-2 italic">"{feedback.comment}"</p>
                  )}
                  {feedback.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={feedback.imageUrl} alt="Feedback image" className="mt-2 h-32 w-full object-cover rounded border" />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rating({ label, value }: { label: string; value: number | null }) {
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
