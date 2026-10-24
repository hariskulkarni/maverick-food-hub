/**
 * GET /api/payments/youpi/status?orderId=…
 *
 * Customer-facing status for the payment-status page. Read-only: it derives a
 * customer-safe view from PgPaymentAttempt.state and never calls the gateway,
 * never captures and never releases an order (D2/D3 — capture happens only in
 * allocateBankCredit(); background jobs do the probing). It never tells a
 * customer they were not charged.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { userCanAccessRestaurant } from '@/server/tenancy';
import { customerPaymentView } from '@/server/pg/customer-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'youpi-status', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!orderId) return Response.json({ error: 'orderId is required', reason: 'bad_body' }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      customerId: true,
      branch: { select: { restaurantId: true } },
      status: true,
      payments: {
        where: { providerName: 'youpi' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!order) return new Response('Not found', { status: 404 });
  if (session.user.role === 'CUSTOMER') {
    if (order.customerId !== session.user.id) return new Response('Not found', { status: 404 }); // uniform: no order-existence oracle
  } else if (session.user.role !== 'SUPER_ADMIN') {
    const ok = await userCanAccessRestaurant(session.user.id, order.branch.restaurantId);
    if (!ok) return new Response('Not found', { status: 404 }); // uniform: no order-existence oracle
  }

  const attempts = await prisma.pgPaymentAttempt.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: 'desc' },
    select: { state: true, expiresAt: true, allocations: { where: { reversedAt: null }, select: { id: true }, take: 1 } },
  });

  const view = customerPaymentView({
    orderStatus: order.status,
    attempts: attempts.map((a) => ({ state: a.state, expiresAt: a.expiresAt, allocated: (a.allocations?.length ?? 0) > 0 })),
    legacyPaymentStatus: order.payments[0]?.status ?? null,
  });
  return Response.json(
    { orderId: order.id, orderCode: order.code, orderStatus: order.status, ...view },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
