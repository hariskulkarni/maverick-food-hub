import { haversineKm, clampTwo } from '@/lib/utils';

export interface CartLine {
  unitPrice: number;
  quantity: number;
}

/**
 * A resolved offer reward ready to apply to a cart. The offer engine
 * (`server/offers.ts`) computes the eligible amountOff and breakdown per
 * offer; the pricing layer just sums them into `discountAmount`. We keep
 * these as plain numbers (not Decimal) — conversion happens at the DB
 * boundary in `orders.ts`.
 */
export interface OfferReward {
  id: string;
  amountOff: number;
  name: string;
  breakdown?: Record<string, unknown> | null;
}

export interface PricingInputs {
  lines: CartLine[];
  taxRatePct: number;
  baseDeliveryFee: number;
  perKmDeliveryFee: number;
  branch?: { lat?: number | null; lng?: number | null } | null;
  delivery?: { lat?: number | null; lng?: number | null } | null;
  coupon?: { flatOff?: number | null; percentOff?: number | null; minOrderAmount?: number | null; maxDiscount?: number | null } | null;
  /**
   * Resolved offer rewards, already evaluated by the Offer engine. Each entry
   * contributes `amountOff` to `discountAmount`. Pass an empty array or omit
   * when no Offers are in play — the legacy `coupon` path still works on its
   * own.
   */
  offers?: OfferReward[];
  walletApplied?: number;
  loyaltyApplied?: number;
  /**
   * Signup bonus amount to apply to *this* order. Already capped server-side
   * by the bonus engine (per-order cap + remaining balance). Layered AFTER
   * offer/coupon discounts so percentage-based offers aren't shrunk by the
   * bonus subtraction.
   */
  signupBonusApplied?: number;
}

export interface PricingResult {
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  discountAmount: number;
  walletApplied: number;
  loyaltyApplied: number;
  signupBonusApplied: number;
  total: number;
  distanceKm: number;
  couponApplied: boolean;
  /**
   * Per-offer line items so the UI can render "Offer X: -₹Y" rows. Empty when
   * no Offers were applied. Independent of `couponApplied`.
   */
  offerBreakdown: { id: string; name: string; amountOff: number; breakdown?: Record<string, unknown> | null }[];
}

/**
 * Cart pricing.
 *
 * Two discount sources are supported and INTENTIONALLY coexist:
 *
 *   1. `coupon` — the legacy `/admin/coupons` screen still writes `Coupon`
 *      rows and the customer cart still accepts a `couponCode`. The
 *      single-coupon model in the input is preserved as-is so existing
 *      tests and admin screens keep working.
 *   2. `offers` — the new Offer engine (`server/offers.ts`) evaluates
 *      campaign-driven promos (auto-apply, stackable, lifecycle-gated, etc.)
 *      and hands resolved rewards down to pricing as a list of
 *      `{ id, amountOff, name }`.
 *
 * Both may apply on the same order. We sum coupon discount + every offer
 * amountOff into `discountAmount`. `couponApplied` only reflects the legacy
 * coupon path; the new path surfaces via `offerBreakdown`.
 *
 * Once the legacy coupon screen is retired, the `coupon` parameter can be
 * dropped — until then, do NOT collapse the two paths into one.
 */
export function pricing(inp: PricingInputs): PricingResult {
  const subtotal = clampTwo(inp.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));

  let distanceKm = 0;
  if (inp.branch?.lat != null && inp.branch?.lng != null && inp.delivery?.lat != null && inp.delivery?.lng != null) {
    distanceKm = haversineKm(
      { lat: inp.branch.lat, lng: inp.branch.lng },
      { lat: inp.delivery.lat, lng: inp.delivery.lng }
    );
  }
  const deliveryFee = clampTwo(inp.baseDeliveryFee + inp.perKmDeliveryFee * Math.max(0, distanceKm - 1));

  let couponDiscount = 0;
  let couponApplied = false;
  if (inp.coupon && (inp.coupon.minOrderAmount == null || subtotal >= Number(inp.coupon.minOrderAmount))) {
    if (inp.coupon.percentOff) couponDiscount = subtotal * (inp.coupon.percentOff / 100);
    if (inp.coupon.flatOff) couponDiscount = Math.max(couponDiscount, Number(inp.coupon.flatOff));
    if (inp.coupon.maxDiscount != null) couponDiscount = Math.min(couponDiscount, Number(inp.coupon.maxDiscount));
    couponDiscount = clampTwo(couponDiscount);
    couponApplied = couponDiscount > 0;
  }

  // Sum Offer rewards — already capped/validated by the Offer engine.
  const offerBreakdown = (inp.offers ?? [])
    .filter((o) => o && o.amountOff > 0)
    .map((o) => ({ id: o.id, name: o.name, amountOff: clampTwo(o.amountOff), breakdown: o.breakdown ?? null }));
  const offerDiscount = clampTwo(offerBreakdown.reduce((s, o) => s + o.amountOff, 0));

  // Combined discount, capped at subtotal so a generous offer+coupon stack
  // can never make the discount exceed what the customer is paying for items.
  const discount = clampTwo(Math.min(subtotal, couponDiscount + offerDiscount));

  const taxable = Math.max(0, subtotal - discount);
  const taxAmount = clampTwo((taxable * inp.taxRatePct) / 100);

  const wallet = clampTwo(Math.max(0, inp.walletApplied ?? 0));
  const loyalty = clampTwo(Math.max(0, inp.loyaltyApplied ?? 0));
  // Signup bonus is layered last so an aggressive total can't drag below 0.
  // The bonus engine already capped this to the per-order ceiling and the
  // grant's remaining balance, so we just clamp here defensively.
  const remainingOwed = Math.max(0, subtotal + taxAmount + deliveryFee - discount - wallet - loyalty);
  const signupBonus = clampTwo(Math.max(0, Math.min(remainingOwed, inp.signupBonusApplied ?? 0)));

  const total = clampTwo(Math.max(0, remainingOwed - signupBonus));

  return {
    subtotal,
    taxAmount,
    deliveryFee,
    discountAmount: discount,
    walletApplied: wallet,
    loyaltyApplied: loyalty,
    signupBonusApplied: signupBonus,
    total,
    distanceKm: clampTwo(distanceKm),
    couponApplied,
    offerBreakdown
  };
}
