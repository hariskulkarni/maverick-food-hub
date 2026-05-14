/**
 * POST /api/customer/offers/apply-code
 *
 * Customer enters a coupon-style code at checkout. Returns the eligibility
 * verdict — eligible codes carry an amountOff + breakdown, ineligible ones
 * carry a `reason` ("expired", "min order ₹500", "wrong channel"…).
 *
 * Body:
 *   {
 *     code: string,
 *     branchId: string,
 *     cart: [{ menuItemId, categoryId?, unitPrice, quantity }]
 *   }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { loadOfferByCode } from '@/server/offers';

export const dynamic = 'force-dynamic';

const CartLine = z.object({
  menuItemId: z.string(),
  categoryId: z.string().nullable().optional(),
  unitPrice: z.number(),
  quantity: z.number().int().min(1)
});

const Body = z.object({
  code: z.string().min(1),
  branchId: z.string(),
  cart: z.array(CartLine),
  channel: z.enum(['ONLINE', 'DINE_IN']).optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const role = session.user.role;
  if (role === 'ADMIN' || role === 'RIDER' || role === 'KITCHEN' || role === 'SUPER_ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const data = Body.parse(await req.json());

  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { id: true, restaurantId: true }
  });
  if (!branch) return new Response('Branch not found', { status: 404 });

  const subtotal = data.cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const result = await loadOfferByCode(data.code, {
    cart: data.cart.map((l) => ({ ...l, categoryId: l.categoryId ?? null })),
    subtotal,
    channel: data.channel ?? 'ONLINE',
    branchId: branch.id,
    restaurantId: branch.restaurantId,
    customerId: session.user.id
  });

  if (!result || !result.evaluation) {
    return Response.json({
      winner: null,
      evaluation: null,
      reason: 'Code not found',
      customerOrderCount: result?.customerOrderCount ?? 0
    });
  }

  return Response.json(result);
}
