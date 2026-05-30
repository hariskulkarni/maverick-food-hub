/**
 * Customer-facing: preview how much signup bonus would apply to a given cart.
 *
 *   POST { cartSubtotal: number } → BonusApplyResult
 *
 * Pure preview — does NOT mutate the grant. Used by the cart page so we can
 * show "₹20 signup bonus will apply" before the customer actually places the
 * order.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { previewSignupBonusForUser } from '@/server/signup-bonus';
import { parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const Body = z.object({
  cartSubtotal: z.number().min(0)
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const { cartSubtotal } = parsed;
  const result = await previewSignupBonusForUser(session.user.id, cartSubtotal);
  return Response.json(result);
}
