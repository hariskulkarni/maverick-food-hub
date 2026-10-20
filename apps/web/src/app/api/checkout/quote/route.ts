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

const Body = z.object({
  branchId: z.string(),
  addressId: z.string().optional(),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP', 'DINE_IN']).optional(),
  items: z.array(z.object({ menuItemId: z.string().optional(), comboId: z.string().optional(), quantity: z.number().int().positive(),
    selectedVariantId: z.string().optional(),
    selectedModifierOptionIds: z.array(z.string()).optional()
  })),
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
  const address = body.addressId ? await prisma.address.findUnique({ where: { id: body.addressId } }) : null;

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
      if (m) {
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
      const c = await prisma.combo.findUnique({ where: { id: it.comboId } });
      if (c) {
        const priced = priceForCombo({ id: c.id, price: Number(c.price) }, hhRules, hhNow);
        lines.push({ unitPrice: priced.effectivePrice, quantity: it.quantity });
      }
    }
  }

  // Legacy coupon path (kept for backward compatibility with /admin/coupons).
  let coupon = null as null | { flatOff?: number | null; percentOff?: number | null; minOrderAmount?: number | null; maxDiscount?: number | null };
  if (body.couponCode) {
    const c = await prisma.coupon.findUnique({ where: { code: body.couponCode } });
    if (c && c.isActive) {
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
  const isDelivery = body.fulfillmentType === 'DELIVERY' || !body.fulfillmentType;
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

  const r = pricing({
    lines,
    taxRatePct: branch.taxRatePct,
    baseDeliveryFee: body.fulfillmentType === 'DELIVERY' || !body.fulfillmentType ? Number(branch.baseDeliveryFee) : 0,
    perKmDeliveryFee: body.fulfillmentType === 'DELIVERY' || !body.fulfillmentType ? Number(branch.perKmDeliveryFee) : 0,
    // Packaging applies to delivery + pickup but not dine-in (served at table).
    packagingFee: body.fulfillmentType === 'DINE_IN' ? 0 : Number(branch.packagingFee),
    branch: { lat: branch.latitude, lng: branch.longitude },
    delivery: address ? { lat: address.latitude, lng: address.longitude } : null,
    deliveryFeeOverride,
    coupon,
    offers,
    walletApplied: body.walletApply,
    loyaltyApplied: body.loyaltyApply
  });
  return Response.json({ ...r, taxRatePct: branch.taxRatePct, zone, zoneBlock });
}
