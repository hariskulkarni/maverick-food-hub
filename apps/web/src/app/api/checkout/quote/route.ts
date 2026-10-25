import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { pricing, type OfferReward } from '@/server/pricing';
import { auth } from '@/server/auth';
import { loadAndApplyOffers, loadOfferByCode } from '@/server/offers';
import { resolveDeliveryTerms } from '@/server/delivery/placement';
import { resolveLineSelections } from '@/server/menu-selections';
import { loadRulesForRestaurant, priceForItem, priceForCombo } from '@/server/happy-hours';
import { clampTwo } from '@/lib/utils';
import { parseOrJsonError } from '@/server/zod-helpers';
import { previewSignupBonusForUser } from '@/server/signup-bonus';
import { isLegacyCouponUsable } from '@/server/coupons';

const Body = z.object({
  branchId: z.string(),
  addressId: z.string().optional(),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP', 'DINE_IN']).optional(),
  items: z.array(z.object({ menuItemId: z.string().optional(), comboId: z.string().optional(), quantity: z.number().int().positive().max(50),
    selectedVariantId: z.string().optional().nullable(),
    selectedModifierOptionIds: z.array(z.string()).max(50).optional()
  })).max(100),
  couponCode: z.string().optional(),
  walletApply: z.number().nonnegative().optional(),
  loyaltyApply: z.number().nonnegative().optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const body = parsed;
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: body.branchId } });
  // P2-15: an address is quoted only for its signed-in owner (same rule as placeOrder) — never read
  // another customer's address (and its coordinates) by id.
  const userId = session?.user?.id ?? null;
  const address = body.addressId && userId ? await prisma.address.findFirst({ where: { id: body.addressId, userId } }) : null;
  const fulfillmentType = body.fulfillmentType ?? 'DELIVERY';

  // Priced lines (for tax/total) + an offer cart (menu items carry id/category
  // so the Offer engine can scope item/category-restricted offers).
  const lines: { unitPrice: number; quantity: number }[] = [];
  const offerCart: { menuItemId: string; categoryId: string | null; unitPrice: number; quantity: number }[] = [];
  // Line pricing MUST mirror placeOrder(): variant price replaces base, happy-hour
  // discounts the size-level price, modifier deltas are added AFTER happy hour.
  // The subtotal feeds resolveDeliveryTerms, so any drift here would make the
  // previewed zone fee / min-order differ from what placeOrder charges/enforces.
  const hhNow = new Date();
  const hhRules = await loadRulesForRestaurant(branch.restaurantId, hhNow);
  for (const it of body.items) {
    if (it.menuItemId) {
      const m = await prisma.menuItem.findFirst({
        where: { id: it.menuItemId, branchId: body.branchId },
        include: {
          category: true,
          variants: { orderBy: { sortOrder: 'asc' } },
          modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } }
        }
      });
      if (!m || !m.isAvailable) {
        // placeOrder refuses this line; a preview that silently drops it would show a wrong total.
        return Response.json({ error: m ? `Item not available: ${m.name}` : 'An item in your cart is no longer on this menu.' }, { status: 400 });
      }
      {
        let selections;
        try {
          selections = resolveLineSelections(
            m.name,
            m.variants.map((v) => ({ id: v.id, name: v.name, price: Number(v.price), isDefault: v.isDefault, isAvailable: v.isAvailable })),
            m.modifierGroups.map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              required: g.required,
              options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta), isAvailable: o.isAvailable }))
            })),
            { selectedVariantId: it.selectedVariantId, selectedModifierOptionIds: it.selectedModifierOptionIds }
          );
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : 'Invalid selection' }, { status: 400 });
        }
        const lineBasePrice = selections.variant ? selections.variant.price : Number(m.price);
        const priced = priceForItem({ id: m.id, categoryId: m.category.id, price: lineBasePrice }, hhRules, hhNow);
        const unitPrice = clampTwo(priced.effectivePrice + selections.modifierDelta);
        lines.push({ unitPrice, quantity: it.quantity });
        offerCart.push({ menuItemId: m.id, categoryId: m.categoryId ?? null, unitPrice, quantity: it.quantity });
      }
    } else if (it.comboId) {
      // P2-15: branch-scoped like placeOrder (a combo id from another branch is not orderable here).
      const c = await prisma.combo.findFirst({ where: { id: it.comboId, branchId: body.branchId } });
      if (!c || c.isAvailable === false) {
        return Response.json({ error: 'A combo in your cart is no longer available.' }, { status: 400 });
      }
      {
        const priced = priceForCombo({ id: c.id, price: Number(c.price) }, hhRules, hhNow);
        lines.push({ unitPrice: priced.effectivePrice, quantity: it.quantity });
      }
    }
  }

  // Legacy coupon path (kept for backward compatibility with /admin/coupons).
  let coupon = null as null | { flatOff?: number | null; percentOff?: number | null; minOrderAmount?: number | null; maxDiscount?: number | null };
  if (body.couponCode) {
    const c = await prisma.coupon.findUnique({
      where: { code: body.couponCode },
      include: { branch: { select: { restaurantId: true } } }
    });
    // Same eligibility as placeOrder(): restaurant scope, start/end date, usage limit.
    if (c && isLegacyCouponUsable(c, { restaurantId: branch.restaurantId })) {
      coupon = {
        flatOff: c.flatOff ? Number(c.flatOff) : null,
        percentOff: c.percentOff,
        minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null
      };
    }
  }

  // New Offer engine — auto-applied offers + the entered code. This MUST mirror
  // placeOrder() exactly so the previewed total equals the charged total.
  const offers: OfferReward[] = [];
  if (session?.user?.id && offerCart.length > 0) {
    const offerSubtotal = offerCart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const offerCtx = {
      cart: offerCart,
      subtotal: offerSubtotal,
      channel: 'ONLINE' as const,
      // P1-7: fulfillment-scoped offers must evaluate exactly as placeOrder does.
      fulfillmentType,
      branchId: branch.id,
      restaurantId: branch.restaurantId,
      customerId: session.user.id,
      now: new Date()
    };
    const seen = new Set<string>();
    try {
      const auto = await loadAndApplyOffers(offerCtx, { autoOnly: true });
      for (const w of auto.winners) {
        if (seen.has(w.offer.id)) continue;
        seen.add(w.offer.id);
        offers.push({ id: w.offer.id, name: w.offer.name, amountOff: w.result.amountOff, breakdown: w.result.breakdown });
      }
      if (body.couponCode) {
        const byCode = await loadOfferByCode(body.couponCode, offerCtx);
        if (byCode?.winner && !seen.has(byCode.winner.offer.id)) {
          seen.add(byCode.winner.offer.id);
          offers.push({
            id: byCode.winner.offer.id,
            name: byCode.winner.offer.name,
            amountOff: byCode.winner.result.amountOff,
            breakdown: byCode.winner.result.breakdown
          });
        }
      }
    } catch {
      /* offer resolution is best-effort for the preview — never blocks a quote */
    }
  }

  // Zone-authoritative delivery terms — identical resolution to placeOrder so the
  // preview equals the charged fee. Only for DELIVERY with a chosen address.
  const isDelivery = fulfillmentType === 'DELIVERY';
  let deliveryFeeOverride: number | undefined;
  let zone: { etaMinutes: number; minOrderPaise: number } | null = null;
  let zoneBlock: { reason: string; message: string; minOrderPaise?: number } | null = null;
  if (isDelivery && address) {
    const subtotalPaise = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100);
    const terms = await resolveDeliveryTerms({ branch, address, subtotalPaise });
    if (terms.kind === 'zone') {
      deliveryFeeOverride = terms.feeRupees;
      zone = { etaMinutes: terms.etaMinutes, minOrderPaise: terms.minOrderPaise };
    } else if (terms.kind === 'reject') {
      zoneBlock = { reason: terms.reason, message: terms.message.replace(/^[A-Z_]+: /, ''), minOrderPaise: terms.minOrderPaise };
    }
  }

  // P1-7: placeOrder auto-applies the signup bonus (on the subtotal); the preview must too.
  let bonusApplied = 0;
  if (userId) {
    const sub = clampTwo(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
    bonusApplied = (await previewSignupBonusForUser(userId, sub).catch(() => ({ appliedAmount: 0 }))).appliedAmount;
  }

  const r = pricing({
    lines,
    taxRatePct: branch.taxRatePct,
    baseDeliveryFee: isDelivery ? Number(branch.baseDeliveryFee) : 0,
    perKmDeliveryFee: isDelivery ? Number(branch.perKmDeliveryFee) : 0,
    // Packaging applies to delivery + pickup but not dine-in (served at table).
    packagingFee: body.fulfillmentType === 'DINE_IN' ? 0 : Number(branch.packagingFee),
    branch: { lat: branch.latitude, lng: branch.longitude },
    delivery: isDelivery && address ? { lat: address.latitude, lng: address.longitude } : null,
    deliveryFeeOverride,
    coupon,
    offers,
    walletApplied: body.walletApply,
    loyaltyApplied: body.loyaltyApply,
    signupBonusApplied: bonusApplied
  });
  return Response.json({ ...r, taxRatePct: branch.taxRatePct, zone, zoneBlock });
}
