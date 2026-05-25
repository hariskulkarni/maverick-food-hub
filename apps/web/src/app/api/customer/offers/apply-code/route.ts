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
import { loadOfferByCode, resolveCartBranch, couponCodeExistsElsewhere } from '@/server/offers';

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

  // Authoritative branch derived from the cart's menu items — never trust a
  // possibly-stale client branchId (see resolveCartBranch).
  const branch = await resolveCartBranch(data.cart.map((l) => l.menuItemId), data.branchId);
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
    // The code wasn't found for THIS cart's restaurant. If it exists for a
    // different restaurant, say so precisely instead of a flat "invalid".
    const elsewhere = await couponCodeExistsElsewhere(data.code);
    return Response.json({
      winner: null,
      evaluation: null,
      reason: elsewhere
        ? "This code is for a different restaurant. Add items from that restaurant to use it."
        : 'Code not found',
      error: elsewhere
        ? "This code is for a different restaurant. Add items from that restaurant to use it."
        : 'Code is invalid or not applicable',
      customerOrderCount: result?.customerOrderCount ?? 0
    });
  }

  return Response.json(result);
}
