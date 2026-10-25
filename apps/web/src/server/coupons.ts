/**
 * Legacy Coupon eligibility (the /admin/coupons model).
 *
 * A coupon is usable for an order at a branch only when:
 *   - it is active,
 *   - validFrom ≤ now (start date) and (validTo unset or > now),
 *   - its usage limit is not exhausted,
 *   - it belongs to the ordering restaurant: a coupon tied to a branch is
 *     valid at any branch of that branch's restaurant; a coupon with no branch
 *     (branchId = null) is platform-wide and valid everywhere.
 *
 * Shared by placeOrder() and the checkout quote so the preview matches the charge.
 */
export type LegacyCouponRow = {
  isActive: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  usedCount: number;
  branchId: string | null;
  branch?: { restaurantId: string } | null;
};

export function isLegacyCouponUsable(c: LegacyCouponRow, ctx: { restaurantId: string; now?: Date }): boolean {
  const now = ctx.now ?? new Date();
  if (!c.isActive) return false;
  if (c.validFrom && c.validFrom > now) return false;
  if (c.validTo && c.validTo <= now) return false;
  if (c.usageLimit && c.usedCount >= c.usageLimit) return false;
  if (c.branchId) {
    if (!c.branch || c.branch.restaurantId !== ctx.restaurantId) return false;
  }
  return true;
}
