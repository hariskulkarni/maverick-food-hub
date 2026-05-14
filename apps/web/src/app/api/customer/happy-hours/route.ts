/**
 * GET /api/customer/happy-hours?restaurantId=
 *
 * Returns currently-active Happy Hour rules in a "lite" shape suited to a
 * client-side refresh hook (e.g. the customer storefront banner that polls
 * every few minutes for "Happy hour ends in X min"). The admin UI is the
 * primary consumer today; we ship this endpoint so the future customer-side
 * widget can already lean on it.
 *
 * No auth: rules are public information. We do not leak validity ranges, just
 * the discount summary + soonest endsAt.
 */
import { NextRequest } from 'next/server';
import {
  loadRulesForRestaurant,
  isRuleInWindowNow,
  minutesUntilHappyHourEnds
} from '@/server/happy-hours';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const restaurantId = req.nextUrl.searchParams.get('restaurantId');
  if (!restaurantId) {
    return new Response('Missing restaurantId', { status: 400 });
  }

  const now = new Date();
  const rules = await loadRulesForRestaurant(restaurantId, now);
  const active = rules.filter((r) => isRuleInWindowNow(r, now));
  const endsAt = minutesUntilHappyHourEnds(active, now);

  return Response.json({
    rules: active.map((r) => ({
      id: r.id,
      name: r.name,
      scope: scopeSummary(r),
      discount: discountSummary(r)
    })),
    endsAt: endsAt?.endsAt ?? null,
    endsInMin: endsAt?.endsInMin ?? null
  });
}

function scopeSummary(r: { scope: string }): string {
  switch (r.scope) {
    case 'RESTAURANT': return 'All restaurant';
    case 'CATEGORY':   return 'Category';
    case 'MENU_ITEM':  return 'Single item';
    case 'COMBO':      return 'Combo';
    default:           return r.scope;
  }
}

function discountSummary(r: {
  discountType: string;
  percentOff: number | null;
  fixedPrice: number | string | null;
  amountOff: number | string | null;
}): string {
  switch (r.discountType) {
    case 'PERCENTAGE':
      return `${Number(r.percentOff ?? 0)}% off`;
    case 'FIXED_PRICE':
      return `Just ₹${Number(r.fixedPrice ?? 0)}`;
    case 'FIXED_AMOUNT_OFF':
      return `₹${Number(r.amountOff ?? 0)} off`;
    default:
      return 'Happy hour';
  }
}
