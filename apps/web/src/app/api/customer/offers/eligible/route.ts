/**
 * POST /api/customer/offers/eligible
 *
 * Returns the full list of offers the customer could apply, with eligibility
 * verdicts (eligible offers carry an amountOff, ineligible ones carry a
 * `reason` string the UI can render as "Add ₹120 more to unlock…"). Also
 * returns `bestPick` — the optimal stackable/non-stackable winner set the
 * server would auto-apply if the customer accepts.
 *
 * Body:
 *   {
 *     branchId: string,
 *     cart: [{ menuItemId, categoryId?, unitPrice, quantity }]
 *   }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { loadAndApplyOffers } from '@/server/offers';

export const dynamic = 'force-dynamic';

const CartLine = z.object({
  menuItemId: z.string(),
  categoryId: z.string().nullable().optional(),
  unitPrice: z.number(),
  quantity: z.number().int().min(1)
});

const Body = z.object({
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

  const result = await loadAndApplyOffers(
    {
      cart: data.cart.map((l) => ({ ...l, categoryId: l.categoryId ?? null })),
      subtotal,
      channel: data.channel ?? 'ONLINE',
      branchId: branch.id,
      restaurantId: branch.restaurantId,
      customerId: session.user.id
    },
    { autoOnly: false, includeAll: true }
  );

  return Response.json({
    subtotal,
    evaluations: result.evaluations,
    bestPick: {
      winners: result.winners,
      totalAmountOff: result.totalAmountOff
    },
    customerOrderCount: result.customerOrderCount
  });
}
