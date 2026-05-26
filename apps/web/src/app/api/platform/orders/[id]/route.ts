import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { refundOrder, RefundError } from '@/server/refunds';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      customer: { select: { id: true, name: true, phone: true, email: true } },
      address: true,
      branch: { include: { restaurant: { select: { id: true, name: true, slug: true } } } },
      assignment: { include: { rider: { include: { user: { select: { id: true, name: true, phone: true } } } } } },
      payments: true,
      statusEvents: { orderBy: { createdAt: 'asc' } },
      refunds: { orderBy: { createdAt: 'desc' } }
    }
  });
  if (!order) return new Response('Not found', { status: 404 });
  return Response.json(order);
}

const RefundBody = z.object({
  amount: z.number().positive(),
  destination: z.enum(['WALLET', 'ORIGINAL_PAYMENT']).default('WALLET'),
  reason: z.string().max(300).optional()
});

/**
 * POST /api/platform/orders/[id]/refund-ish — issue a refund on this order.
 * Defaults to the customer's wallet; admin may opt for the original payment
 * method. Super-admin only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;

  let body: z.infer<typeof RefundBody>;
  try {
    body = RefundBody.parse(await req.json());
  } catch {
    return Response.json({ ok: false, message: 'Invalid refund request.' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  try {
    const result = await refundOrder({
      orderId: id,
      amount: body.amount,
      destination: body.destination,
      reason: body.reason ?? null,
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      ipAddress: ip
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof RefundError) {
      return Response.json({ ok: false, message: e.message }, { status: e.status });
    }
    throw e;
  }
}
