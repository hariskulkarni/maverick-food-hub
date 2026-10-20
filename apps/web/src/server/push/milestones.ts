import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { sendWebPush } from './webpush';

const COPY: Record<string, { title: string; body: (code: string) => string }> = {
  ACCEPTED: { title: 'Order confirmed', body: (c) => `Order ${c} is confirmed by the restaurant.` },
  PREPARING: { title: 'Preparing your order', body: (c) => `Order ${c} is being prepared.` },
  OUT_FOR_DELIVERY: { title: 'Out for delivery', body: (c) => `Order ${c} is on its way.` },
  RIDER_REACHED_CUSTOMER: { title: 'Your rider has arrived', body: (c) => `Order ${c}: your rider is at your door.` },
  DELIVERED: { title: 'Delivered', body: (c) => `Order ${c} has been delivered. Enjoy!` }
};

export const MILESTONE_STATUSES = Object.keys(COPY);

/**
 * Web-push a customer-facing order milestone. Opt-in == the user has at least one
 * WebPushSubscription. Best-effort: never throws (sits in the order transition path).
 */
export async function pushOrderMilestone(a: {
  orderId: string;
  code: string;
  customerId: string;
  status: string;
}): Promise<void> {
  const copy = COPY[a.status];
  if (!copy) return;
  try {
    const subs = await prisma.webPushSubscription.count({ where: { userId: a.customerId } });
    if (subs === 0) return;
    await sendWebPush(a.customerId, {
      title: copy.title,
      body: copy.body(a.code),
      url: `/orders/${a.orderId}`,
      tag: `order-${a.orderId}`
    });
  } catch (e) {
    log.error({ err: (e as Error).message, orderId: a.orderId, status: a.status }, 'order milestone web push failed');
  }
}
