/**
 * Order machine + side effects.
 *
 * Single source of truth for status transitions. Every transition writes an
 * `OrderStatusEvent`, fires a realtime event on `order:{id}` and `branch:{branch}:orders`,
 * dispatches the appropriate customer notification, and updates ETA timestamps.
 */

import { OrderStatus, PaymentMethod, PaymentStatus, AssignmentStatus, FulfillmentType, Prisma } from '@prisma/client';
import { prisma } from './db';
import { publish } from './realtime';
import { notify } from './notifications';
import { genDeliveryOtp, genOrderCode, STATUS_LABELS } from '@/lib/utils';
import { pricing, type OfferReward } from './pricing';
import { paymentProvider } from './payments';
import { isCategoryAvailableNow } from './category-availability';
import { log } from './log';
import { brand } from '@/lib/brand';
import { loadAndApplyOffers, loadOfferByCode, recordRedemption, type OfferCartLine } from './offers';
import { audit } from './audit';
import { notifyRidersOfNewOrder } from './rider-push';
import { maybeOfferAsBatch } from './batch-dispatch';
import { resolveQualifyingFreebie, grantFreebieTx, restoreFreebieStock } from './freebies';
import { clampTwo } from '@/lib/utils';
import { loadRulesForRestaurant, priceForItem, priceForCombo } from './happy-hours';
import { refreshChallengeProgressForOrder } from './challenges';
import { previewSignupBonusForUser, holdSignupBonusForOrder, commitSignupBonusForOrder, restoreSignupBonusForOrder } from './signup-bonus';
import { sendDeliveryOtpSms } from './notify-templates';
import { resolveLineSelections } from './menu-selections';
import { groupOrderChannel } from './group-scope';

// State machine. Cancellation is allowed from any pre-delivery state into the
// matching CANCELLED_BY_* terminal. Legacy CANCELLED is kept for back-compat.
export const ALLOWED_NEXT: Record<OrderStatus, OrderStatus[]> = {
  // Pre-payment funnel
  PAYMENT_PENDING:          [OrderStatus.RECEIVED, OrderStatus.PAYMENT_FAILED, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_ADMIN],
  PAYMENT_FAILED:           [OrderStatus.RECEIVED, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
  // Restaurant funnel
  RECEIVED:                 [OrderStatus.ACCEPTED, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_RESTAURANT, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED],
  ACCEPTED:                 [OrderStatus.PREPARING, OrderStatus.CANCELLED_BY_RESTAURANT, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
  PREPARING:                [OrderStatus.READY, OrderStatus.CANCELLED_BY_RESTAURANT, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
  // DELIVERED is reachable directly from READY for PICKUP + DINE_IN orders
  // (customer collects at counter / meal served at table — no rider leg). The
  // transition handler gates the rider-pool dispatch on fulfillmentType, so a
  // DELIVERY order still flows READY → OUT_FOR_DELIVERY as before.
  READY:                    [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
  // Rider funnel
  RIDER_ASSIGNED:           [OrderStatus.RIDER_REACHED_RESTAURANT, OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED_BY_ADMIN],
  RIDER_REACHED_RESTAURANT: [OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED_BY_ADMIN],
  PICKED_UP:                [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RIDER_REACHED_CUSTOMER, OrderStatus.DELIVERY_FAILED],
  OUT_FOR_DELIVERY:         [OrderStatus.RIDER_REACHED_CUSTOMER, OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
  RIDER_REACHED_CUSTOMER:   [OrderStatus.DELIVERED, OrderStatus.DELIVERY_OTP_FAILED, OrderStatus.CUSTOMER_UNREACHABLE, OrderStatus.DELIVERY_FAILED],
  // Delivery failure recovery
  DELIVERY_OTP_FAILED:      [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED, OrderStatus.CANCELLED_BY_ADMIN],
  CUSTOMER_UNREACHABLE:     [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED, OrderStatus.CANCELLED_BY_ADMIN],
  DELIVERY_FAILED:          [OrderStatus.REFUND_PENDING, OrderStatus.CANCELLED_BY_ADMIN],
  // Happy ending → refund path
  DELIVERED:                [OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED],
  // Cancellation terminals
  CANCELLED:                [],
  CANCELLED_BY_CUSTOMER:    [OrderStatus.REFUND_PENDING],
  CANCELLED_BY_RESTAURANT:  [OrderStatus.REFUND_PENDING],
  CANCELLED_BY_ADMIN:       [OrderStatus.REFUND_PENDING],
  // Refund funnel
  REFUND_PENDING:           [OrderStatus.REFUND_INITIATED, OrderStatus.REFUNDED],
  REFUND_INITIATED:         [OrderStatus.REFUNDED],
  REFUNDED:                 []
};

export class OrderTransitionError extends Error {}

export interface PlaceOrderInput {
  branchId: string;
  customerId: string;
  addressId?: string | null;
  items: {
    menuItemId?: string;
    comboId?: string;
    quantity: number;
    notes?: string;
    /** Chosen variant (size) for this menu item. Its price replaces the base. */
    selectedVariantId?: string | null;
    /** Chosen modifier option ids (add-ons etc.). Deltas add to the line price. */
    selectedModifierOptionIds?: string[];
  }[];
  /** Legacy /admin/coupons-style code. Kept for back-compat. */
  couponCode?: string;
  /**
   * New Offer-engine code (e.g. customer typed a campaign code). Auto-apply
   * offers are also resolved server-side even when this is absent.
   */
  offerCode?: string;
  paymentMethod: PaymentMethod;
  customerNotes?: string;
  walletApply?: number;
  loyaltyApply?: number;
  /**
   * Fulfillment type. Defaults to DELIVERY (existing behaviour). PICKUP and
   * DINE_IN skip rider assignment + delivery fee. DINE_IN additionally
   * requires `reservationId` so the deposit credit + discount apply.
   */
  fulfillmentType?: FulfillmentType;
  /** Future slot for a scheduled order (must be within operating hours). */
  scheduledFor?: Date | string | null;
  /** DINE_IN only — the confirmed reservation this order redeems. */
  reservationId?: string | null;
}

export async function placeOrder(input: PlaceOrderInput) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: input.branchId } });
  if (!branch.isActive) {
    // Paused/inactive branches reject *new* orders. In-flight orders continue
    // through transitionOrder unaffected. validate-address surfaces this earlier
    // in the funnel but a direct POST to /api/orders must still be guarded.
    throw new Error('Branch is not accepting new orders right now');
  }
  const address = input.addressId
    ? await prisma.address.findUnique({ where: { id: input.addressId } })
    : null;
  if (input.addressId && !address) {
    throw new Error('Selected address could not be found');
  }

  // Load happy-hour rules once for the branch's restaurant. The resolver
  // applies them per-line below so each item / combo locks in the price that
  // was in effect at the moment of order placement. This is also our
  // server-side authority for price-locking — even if the cart held a stale
  // higher price, the order ledger uses what's active *now*.
  const branchWithRestaurant = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: {
      restaurantId: true,
      restaurant: {
        select: {
          allowFreebies: true,
          parentId: true,
          // Order-flow toggles — enforced server-side below so a direct API call
          // can't use a fulfillment mode the restaurant has switched off.
          selfPickupEnabled: true,
          scheduledOrdersEnabled: true,
          dineInEnabled: true
        }
      }
    }
  });
  const hhNow = new Date();
  const hhRules = branchWithRestaurant
    ? await loadRulesForRestaurant(branchWithRestaurant.restaurantId, hhNow)
    : [];
  // Track which happy-hour rule was applied to each line for the post-create
  // audit log. Map by index into `lines` so we can attribute savings back.
  const hhAppliedByLine: { ruleId: string; ruleName: string; originalPrice: number; effectivePrice: number; quantity: number }[] = [];

  const lines: { name: string; unitPrice: number; quantity: number; menuItemId?: string; categoryId?: string | null; comboId?: string; notes?: string; selectedVariantName?: string | null; modifiersSummary?: string | null }[] = [];
  for (const it of input.items) {
    if (it.menuItemId) {
      // Include the parent category + its availability rows so we can enforce
      // both the item-level and category-level windows in one round-trip.
      const m = await prisma.menuItem.findUniqueOrThrow({
        where: { id: it.menuItemId },
        include: {
          category: { include: { availabilities: true } },
          variants: { orderBy: { sortOrder: 'asc' } },
          modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } }
        }
      });
      if (!m.isAvailable) throw new Error(`Item not available: ${m.name}`);
      // Category schedule guard: if the parent category is disabled or
      // currently off-hours, the item cannot be ordered — even if the item
      // itself is marked available. The customer UI already filters these
      // out; this is the server-side enforcement for direct API callers.
      const catStatus = isCategoryAvailableNow({
        id: m.category.id,
        name: m.category.name,
        isActive: m.category.isActive,
        scheduleEnabled: m.category.scheduleEnabled,
        availabilities: m.category.availabilities
      });
      if (!catStatus.available) {
        const reason = catStatus.reason === 'disabled'
          ? 'category is currently unavailable'
          : catStatus.reason === 'off_hours'
            ? `category "${m.category.name}" is outside ordering hours`
            : `category "${m.category.name}" has no active schedule`;
        throw new Error(`Cannot order ${m.name}: ${reason}`);
      }
      // Variant + modifier resolution. Server-authoritative: the chosen variant
      // price REPLACES the base, and modifier deltas ADD on top. Validation of
      // min/max/required + availability happens here — we never trust client
      // prices. Throws on any invalid selection.
      const selections = resolveLineSelections(
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
      // The base for happy-hour pricing is the variant price when a variant is
      // chosen, otherwise the item's own price. Happy-hour discounts the
      // size-level price; modifier add-ons are never discounted, so we add the
      // modifier delta AFTER the happy-hour resolver runs.
      const lineBasePrice = selections.variant ? selections.variant.price : Number(m.price);
      const priced = priceForItem(
        { id: m.id, categoryId: m.category.id, price: lineBasePrice },
        hhRules,
        hhNow
      );
      if (priced.rule) {
        hhAppliedByLine.push({
          ruleId: priced.rule.id,
          ruleName: priced.rule.name,
          originalPrice: priced.originalPrice,
          effectivePrice: priced.effectivePrice,
          quantity: it.quantity
        });
      }
      const lineUnitPrice = clampTwo(priced.effectivePrice + selections.modifierDelta);
      lines.push({
        name: m.name,
        unitPrice: lineUnitPrice,
        quantity: it.quantity,
        menuItemId: m.id,
        categoryId: m.category.id,
        notes: it.notes,
        selectedVariantName: selections.variantName,
        modifiersSummary: selections.modifiersSummary
      });
    } else if (it.comboId) {
      const c = await prisma.combo.findUniqueOrThrow({
        where: { id: it.comboId },
        include: { items: { include: { menuItem: true } } }
      });
      if (!c.isAvailable) throw new Error(`Combo not available: ${c.name}`);
      // Combo is gated on every constituent menu item being available — if any
      // ingredient is 86'd the whole combo cannot be ordered.
      const unavailableItem = c.items.find((i) => !i.menuItem.isAvailable);
      if (unavailableItem) {
        throw new Error(`Combo cannot be ordered: ${unavailableItem.menuItem.name} is currently unavailable`);
      }
      // Combos have no menu-category — offers that scope by category won't
      // match combo lines; that's intentional. Happy-hour rules with COMBO or
      // RESTAURANT scope still apply.
      const priced = priceForCombo({ id: c.id, price: Number(c.price) }, hhRules, hhNow);
      if (priced.rule) {
        hhAppliedByLine.push({
          ruleId: priced.rule.id,
          ruleName: priced.rule.name,
          originalPrice: priced.originalPrice,
          effectivePrice: priced.effectivePrice,
          quantity: it.quantity
        });
      }
      lines.push({ name: c.name, unitPrice: priced.effectivePrice, quantity: it.quantity, comboId: c.id, categoryId: null, notes: it.notes });
    }
  }

  let coupon: { id: string; flatOff?: number | null; percentOff?: number | null; minOrderAmount?: number | null; maxDiscount?: number | null } | null = null;
  if (input.couponCode) {
    const found = await prisma.coupon.findUnique({ where: { code: input.couponCode } });
    if (found && found.isActive && (!found.validTo || found.validTo > new Date()) && (!found.usageLimit || found.usedCount < found.usageLimit)) {
      coupon = {
        id: found.id,
        flatOff: found.flatOff ? Number(found.flatOff) : null,
        percentOff: found.percentOff,
        minOrderAmount: found.minOrderAmount ? Number(found.minOrderAmount) : null,
        maxDiscount: found.maxDiscount ? Number(found.maxDiscount) : null
      };
    }
  }

  // Offer engine resolution. Two passes:
  //   1. autoOnly — discover auto-apply campaign winners regardless of code.
  //   2. by-code  — if the customer typed an offerCode, also evaluate it.
  // Both winner sets are merged, deduped by offerId, and handed to pricing.
  // The engine internally handles stacking + priority within each pass; here
  // we just union them since a typed code is an explicit customer choice.
  // TODO: when the dine-in flow lands, pass channel='DINE_IN' instead.
  const offerCart: OfferCartLine[] = lines
    .filter((l) => l.menuItemId)
    .map((l) => ({ menuItemId: l.menuItemId!, categoryId: l.categoryId ?? null, unitPrice: l.unitPrice, quantity: l.quantity, name: l.name }));
  const offerSubtotal = clampTwo(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const offerCtxBase = {
    cart: offerCart,
    subtotal: offerSubtotal,
    channel: 'ONLINE' as const,
    // Fulfillment targeting for BOGO + fulfillment-scoped offers. Defaults to
    // DELIVERY — the same default applied during fulfillment resolution below.
    fulfillmentType: (input.fulfillmentType ?? 'DELIVERY') as 'DELIVERY' | 'PICKUP' | 'DINE_IN',
    branchId: branch.id,
    restaurantId: branch.restaurantId,
    customerId: input.customerId,
    now: new Date()
  };

  const offerWinners: { id: string; name: string; amountOff: number; breakdown: Record<string, unknown> | null }[] = [];
  const seenOfferIds = new Set<string>();

  if (offerCart.length > 0) {
    // Pass 1: auto-apply discovery.
    const autoPick = await loadAndApplyOffers(offerCtxBase, { autoOnly: true });
    for (const w of autoPick.winners) {
      if (seenOfferIds.has(w.offer.id)) continue;
      seenOfferIds.add(w.offer.id);
      offerWinners.push({ id: w.offer.id, name: w.offer.name, amountOff: w.result.amountOff, breakdown: w.result.breakdown });
    }

    // Pass 2: typed code, if any.
    if (input.offerCode) {
      const byCode = await loadOfferByCode(input.offerCode, offerCtxBase);
      if (byCode?.winner && !seenOfferIds.has(byCode.winner.offer.id)) {
        seenOfferIds.add(byCode.winner.offer.id);
        offerWinners.push({
          id: byCode.winner.offer.id,
          name: byCode.winner.offer.name,
          amountOff: byCode.winner.result.amountOff,
          breakdown: byCode.winner.result.breakdown
        });
      }
    }
  }

  const offerRewards: OfferReward[] = offerWinners.map((w) => ({
    id: w.id,
    name: w.name,
    amountOff: w.amountOff,
    breakdown: w.breakdown
  }));

  // Signup bonus preview — uses subtotal so the engine's per-order cap
  // calculation has the right denominator. We hold the amount inside the
  // order-create transaction below so concurrent checkouts can't double-claim.
  const subtotalForBonus = clampTwo(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const bonusPreview = await previewSignupBonusForUser(input.customerId, subtotalForBonus);

  // Freebie/gift resolution — does this order's subtotal earn a free gift?
  // Read-only selection here (best qualifying in-stock rule); the actual
  // stock claim + ₹0 line insert happens atomically inside the order txn so
  // concurrent qualifying orders can't both grab the last unit. The freebie
  // does NOT change pricing — it's a ₹0 line, revenue is unaffected.
  const qualifyingFreebie = await resolveQualifyingFreebie(
    branch.id,
    subtotalForBonus,
    branchWithRestaurant?.restaurant?.allowFreebies ?? false
  );

  // ── Fulfillment resolution ─────────────────────────────────────────────────
  const fulfillmentType: FulfillmentType = input.fulfillmentType ?? FulfillmentType.DELIVERY;
  const isDelivery = fulfillmentType === FulfillmentType.DELIVERY;

  // Server-side enforcement of the restaurant's order-flow toggles. The UI gates
  // these too, but a direct API caller must not be able to use a mode the
  // restaurant has switched off.
  const flow = branchWithRestaurant?.restaurant;
  if (fulfillmentType === FulfillmentType.PICKUP && flow && !flow.selfPickupEnabled) {
    throw new Error('Self-pickup is not available at this restaurant');
  }
  if (fulfillmentType === FulfillmentType.DINE_IN && flow && !flow.dineInEnabled) {
    throw new Error('Dine-in is not available at this restaurant');
  }

  // DINE_IN must carry a CONFIRMED reservation belonging to this customer +
  // branch, not already redeemed by another order. We snapshot its deposit +
  // discount % (the reservation honours what was agreed at booking time).
  let reservation: { id: string; depositAmount: number; depositPaid: boolean; discountPct: number } | null = null;
  if (fulfillmentType === FulfillmentType.DINE_IN) {
    if (!input.reservationId) throw new Error('Dine-in orders require a reservation');
    const r = await prisma.reservation.findUnique({ where: { id: input.reservationId }, include: { order: true } });
    if (!r) throw new Error('Reservation not found');
    if (r.customerId !== input.customerId) throw new Error('Reservation belongs to another customer');
    if (r.branchId !== branch.id) throw new Error('Reservation is for a different branch');
    if (r.order) throw new Error('This reservation has already been redeemed by another order');
    if (r.status === 'CANCELLED' || r.status === 'NO_SHOW') throw new Error('Reservation is no longer active');
    reservation = {
      id: r.id,
      depositAmount: Number(r.depositAmount),
      depositPaid: r.depositPaid,
      discountPct: r.discountPct
    };
  }

  // Scheduled-order guard: only honour a future scheduledFor when the restaurant
  // allows scheduling AND the slot is genuinely in the future. Otherwise the
  // order is placed for "now" (scheduledFor stays null). Server-authoritative —
  // the UI gates this too, but a direct API call can't schedule when disabled.
  let scheduledFor: Date | null = null;
  if (input.scheduledFor && flow?.scheduledOrdersEnabled) {
    const when = new Date(input.scheduledFor);
    if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
      scheduledFor = when;
    }
  }

  const priced = pricing({
    lines: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
    taxRatePct: branch.taxRatePct,
    // PICKUP + DINE_IN never carry a delivery fee — force both base + per-km to
    // 0 and pass no delivery coords so the distance calc can't add anything.
    baseDeliveryFee: isDelivery ? Number(branch.baseDeliveryFee) : 0,
    perKmDeliveryFee: isDelivery ? Number(branch.perKmDeliveryFee) : 0,
    // Packaging applies to DELIVERY + PICKUP (food is packed to go) but never
    // to DINE_IN (served at the table). DINE_IN forces it to 0.
    packagingFee: fulfillmentType === FulfillmentType.DINE_IN ? 0 : Number(branch.packagingFee),
    branch: { lat: branch.latitude, lng: branch.longitude },
    delivery: isDelivery && address ? { lat: address.latitude, lng: address.longitude } : null,
    coupon,
    offers: offerRewards,
    walletApplied: input.walletApply ?? 0,
    loyaltyApplied: input.loyaltyApply ?? 0,
    signupBonusApplied: bonusPreview.appliedAmount
  });

  // ── Dine-in deposit credit + reservation discount ───────────────────────────
  // The reservation's % discount comes off the (already-priced) total, then the
  // paid deposit is credited against what remains. Both are clamped so the
  // total never goes negative. We snapshot the deposit credit on the order for
  // reporting (reservationDepositApplied) and fold the discount into
  // discountAmount so existing reports/refunds treat it uniformly.
  let reservationDepositApplied = 0;
  let dineInTotal = priced.total;
  let dineInDiscountAdded = 0;
  if (reservation) {
    dineInDiscountAdded = clampTwo((priced.total * reservation.discountPct) / 100);
    dineInTotal = clampTwo(priced.total - dineInDiscountAdded);
    if (reservation.depositPaid && reservation.depositAmount > 0) {
      reservationDepositApplied = clampTwo(Math.min(reservation.depositAmount, dineInTotal));
      dineInTotal = clampTwo(dineInTotal - reservationDepositApplied);
    }
  }
  const finalTotal = reservation ? dineInTotal : priced.total;
  const finalDiscount = clampTwo(priced.discountAmount + dineInDiscountAdded);

  const order = await prisma.$transaction(async (tx) => {
    // Claim the freebie atomically (conditional stock decrement). If we win a
    // unit, build the ₹0 gift line + record the rule id on the order so we can
    // restore stock on cancel/removal. If the last unit was lost to a race,
    // freebieLine is null and the order simply ships without a gift.
    const freebieLine = qualifyingFreebie ? await grantFreebieTx(tx, qualifyingFreebie) : null;
    const grantedFreebieRuleId = freebieLine ? qualifyingFreebie!.ruleId : null;

    const itemCreates = lines.map((l) => ({
      name: l.name,
      unitPrice: l.unitPrice as any,
      quantity: l.quantity,
      notes: l.notes,
      menuItemId: l.menuItemId,
      comboId: l.comboId,
      selectedVariantName: l.selectedVariantName ?? null,
      modifiersSummary: l.modifiersSummary ?? null
    }));
    if (freebieLine) {
      itemCreates.push({
        name: freebieLine.name,
        unitPrice: freebieLine.unitPrice as any,
        quantity: freebieLine.quantity,
        notes: undefined,
        menuItemId: freebieLine.menuItemId,
        comboId: undefined,
        isFreebie: true
      } as any);
    }

    const o = await tx.order.create({
      data: {
        code: genOrderCode(),
        branchId: branch.id,
        customerId: input.customerId,
        addressId: address?.id ?? null,
        status: OrderStatus.RECEIVED,
        subtotal: priced.subtotal as any,
        taxAmount: priced.taxAmount as any,
        deliveryFee: priced.deliveryFee as any,
        packagingFee: priced.packagingFee as any,
        discountAmount: finalDiscount as any,
        walletApplied: priced.walletApplied as any,
        loyaltyApplied: priced.loyaltyApplied as any,
        signupBonusApplied: priced.signupBonusApplied as any,
        total: finalTotal as any,
        paymentMethod: input.paymentMethod,
        customerNotes: input.customerNotes,
        // DELIVERY → delivery OTP. PICKUP → pickup handover code. DINE_IN → neither.
        deliveryOtp: fulfillmentType === FulfillmentType.DELIVERY ? genDeliveryOtp() : null,
        pickupCode: fulfillmentType === FulfillmentType.PICKUP ? genDeliveryOtp() : null,
        fulfillmentType,
        scheduledFor: scheduledFor,
        reservationId: reservation?.id ?? null,
        reservationDepositApplied: reservationDepositApplied as any,
        freebieRuleId: grantedFreebieRuleId,
        items: { create: itemCreates },
        statusEvents: { create: [{ status: OrderStatus.RECEIVED, note: 'Placed by customer' }] }
      }
    });
    // Mark the reservation redeemed + seated within the same transaction so two
    // concurrent checkouts can't both claim the same table booking.
    if (reservation) {
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'SEATED' }
      });
    }
    if (coupon) {
      // The coupon's share of the combined discount: subtract the sum of
      // offer amounts so we don't double-count when both paths fire on the
      // same order. Bounded at 0 since discount is capped at subtotal.
      const offersTotal = priced.offerBreakdown.reduce((s, o) => s + o.amountOff, 0);
      const couponAmount = Math.max(0, priced.discountAmount - offersTotal);
      await tx.couponRedemption.create({
        data: { couponId: coupon.id, orderId: o.id, userId: input.customerId, amountOff: couponAmount as any }
      });
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }
    // Offer-engine redemptions: one row per winning offer. Audit logs fire
    // after the txn commits (audit() is best-effort and must not roll us back).
    for (const w of offerWinners) {
      await recordRedemption(tx, w.id, o.id, input.customerId, w.amountOff, w.breakdown, 'ONLINE');
    }
    // Signup-bonus pending hold — inside the same transaction so we can't
    // double-claim. The bonus moves from `pendingAmount` to `usedAmount` once
    // the order transitions to DELIVERED (or is restored on cancel/refund).
    if (priced.signupBonusApplied > 0) {
      await holdSignupBonusForOrder(tx, input.customerId, o.id, priced.signupBonusApplied);
    }
    if (priced.walletApplied > 0) {
      const wallet = await tx.wallet.upsert({ where: { userId: input.customerId }, update: {}, create: { userId: input.customerId } });
      if (Number(wallet.balance) < priced.walletApplied) {
        // Aborts the transaction → no order row, no debit. Frontend should refresh
        // the wallet view and let the customer retry.
        throw new Error('Wallet balance is lower than the amount you tried to apply');
      }
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: priced.walletApplied as any } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, orderId: o.id, type: 'ORDER_DEBIT', amount: priced.walletApplied as any } });
    }
    if (priced.loyaltyApplied > 0) {
      const account = await tx.loyaltyAccount.upsert({ where: { userId: input.customerId }, update: {}, create: { userId: input.customerId } });
      const points = Math.round(priced.loyaltyApplied); // 1pt = ₹1
      if (account.pointsBalance < points) {
        throw new Error('Loyalty points balance is lower than the amount you tried to redeem');
      }
      await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { decrement: points }, lifetimeRedeem: { increment: points } } });
      await tx.loyaltyTransaction.create({ data: { accountId: account.id, orderId: o.id, type: 'REDEEM', points: -points } });
    }
    return o;
  });

  // Realtime: surface to admin/kitchen. Also fan out to the group channel so a
  // parent restaurant's unified board receives orders from every child. The
  // root is the restaurant's parent when it's a child, else itself (so a solo
  // restaurant's group channel is simply its own id — no behaviour change).
  publish(`branch:${branch.id}:orders`, { kind: 'order:new', orderId: order.id, branchId: branch.id });
  const groupRootId = branchWithRestaurant?.restaurant?.parentId ?? branch.restaurantId;
  publish(groupOrderChannel(groupRootId), { kind: 'order:new', orderId: order.id, branchId: branch.id });
  publish(`order:${order.id}`, { kind: 'status', orderId: order.id, status: 'RECEIVED', at: new Date().toISOString() });

  // Audit each applied offer. audit() is best-effort and never throws — we
  // intentionally fire these AFTER the order txn commits so a log failure
  // can't roll back a paid order.
  for (const w of offerWinners) {
    await audit('offer.applied', {
      actorId: input.customerId,
      restaurantId: branch.restaurantId,
      entityType: 'Offer',
      entityId: w.id,
      before: null,
      after: { offerId: w.id, amountOff: w.amountOff, breakdown: w.breakdown }
    });
  }
  // Audit each happy-hour rule that locked a discounted price on this order.
  // We snapshot original + effective prices so any post-hoc dispute can show
  // exactly what the customer paid and which rule rewrote the price.
  for (const hh of hhAppliedByLine) {
    await audit('happyhour.applied', {
      actorId: input.customerId,
      restaurantId: branch.restaurantId,
      entityType: 'HappyHourRule',
      entityId: hh.ruleId,
      before: null,
      after: {
        orderId: order.id,
        ruleId: hh.ruleId,
        ruleName: hh.ruleName,
        originalPrice: hh.originalPrice,
        effectivePrice: hh.effectivePrice,
        quantity: hh.quantity,
        savedPerUnit: clampTwo(hh.originalPrice - hh.effectivePrice),
        totalSaved: clampTwo((hh.originalPrice - hh.effectivePrice) * hh.quantity)
      }
    });
  }

  // Customer ack. Notification failures must not roll back the order — the
  // order has already been committed above and the customer's payment intent
  // depends on the response landing successfully.
  const customer = await prisma.user.findUnique({ where: { id: input.customerId } });
  if (customer?.phone) {
    await notify.sms({
      to: customer.phone,
      userId: customer.id,
      template: 'order.placed',
      restaurantId: branch.restaurantId,
      body: `${brand.name}: Order ${order.code} received. We'll start cooking once accepted.`
    }).catch((e) => log.error({ err: (e as Error).message, orderId: order.id }, 'order.placed sms failed'));
  }

  // Kick off payment if Razorpay. Amount is `finalTotal` — for dine-in this is
  // after the reservation discount + deposit credit, so the customer pays the
  // right reduced amount.
  if (input.paymentMethod === PaymentMethod.RAZORPAY) {
    const provider = await paymentProvider(branch.restaurantId);
    const pOrder = await provider.createOrder({
      orderId: order.id,
      amount: finalTotal,
      currency: 'INR',
      customer: { name: customer?.name, phone: customer?.phone, email: customer?.email }
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: PaymentMethod.RAZORPAY,
        status: PaymentStatus.PENDING,
        amount: finalTotal as any,
        currency: 'INR',
        providerName: pOrder.providerName,
        providerRef: pOrder.providerOrderId,
        providerData: pOrder.raw as any
      }
    });
    // Razorpay orders are auto-accepted (if the restaurant opts in) only AFTER
    // payment is captured — that happens in the payment webhook/verify path,
    // not here, because the order isn't paid yet.
    return { order, payment: pOrder };
  } else {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: input.paymentMethod,
        status: input.paymentMethod === PaymentMethod.COD ? PaymentStatus.PENDING : PaymentStatus.CAPTURED,
        amount: finalTotal as any,
        currency: 'INR',
        providerName: input.paymentMethod === PaymentMethod.COD ? 'cod' : 'wallet'
      }
    });
    // ── Auto-accept ──────────────────────────────────────────────────────────
    // COD / wallet orders are confirmed at placement (no pending payment gate),
    // so if the restaurant has autoAcceptOrders on, move RECEIVED → ACCEPTED
    // immediately. Best-effort: a transition failure must not fail the order
    // (the order is already committed; the worst case is it sits in the kitchen
    // "New" column awaiting a manual accept). Fire-and-forget.
    await maybeAutoAccept(order.id, branch.restaurantId).catch((e) =>
      log.error({ err: (e as Error).message, orderId: order.id }, 'auto-accept failed')
    );
    return { order, payment: null };
  }
}

/**
 * If the restaurant has `autoAcceptOrders` enabled, transition a freshly-placed
 * RECEIVED order straight to ACCEPTED. Used by the COD/wallet placement path
 * and by the payment-capture path for Razorpay orders. Idempotent + safe — only
 * acts when the order is still RECEIVED.
 */
export async function maybeAutoAccept(orderId: string, restaurantId: string, actorId?: string): Promise<void> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { autoAcceptOrders: true }
  });
  if (!restaurant?.autoAcceptOrders) return;
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (order?.status !== OrderStatus.RECEIVED) return;
  await transitionOrder(orderId, OrderStatus.ACCEPTED, {
    actorId,
    note: 'Auto-accepted (restaurant setting)'
  });
}

export async function transitionOrder(orderId: string, next: OrderStatus, opts: { actorId?: string; note?: string } = {}) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { customer: true, branch: { select: { restaurantId: true, restaurant: { select: { parentId: true } } } } }
  });
  // Idempotent: a double-click or replay that targets the current state is a no-op success.
  if (order.status === next) return order;
  if (!ALLOWED_NEXT[order.status].includes(next)) {
    throw new OrderTransitionError(`Cannot transition ${order.status} → ${next}`);
  }
  const stamp: Partial<Record<keyof typeof Prisma.OrderScalarFieldEnum, Date>> = {};
  switch (next) {
    case 'ACCEPTED':         stamp.acceptedAt = new Date(); break;
    case 'PREPARING':        stamp.preparingAt = new Date(); break;
    case 'READY':            stamp.readyAt = new Date(); break;
    case 'OUT_FOR_DELIVERY': stamp.outForDeliveryAt = new Date(); break;
    case 'PICKED_UP':        stamp.outForDeliveryAt ??= new Date(); break;
    case 'DELIVERED':        stamp.deliveredAt = new Date(); break;
    case 'CANCELLED':
    case 'CANCELLED_BY_CUSTOMER':
    case 'CANCELLED_BY_RESTAURANT':
    case 'CANCELLED_BY_ADMIN':
      stamp.cancelledAt = new Date(); break;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.order.update({
      where: { id: orderId },
      data: { status: next, ...(stamp as any), cancelReason: next === 'CANCELLED' ? opts.note : undefined }
    });
    await tx.orderStatusEvent.create({ data: { orderId, status: next, actorId: opts.actorId, note: opts.note } });
    if (next === OrderStatus.DELIVERED) {
      // Earn loyalty: 5pt per ₹100 of subtotal
      const account = await tx.loyaltyAccount.upsert({ where: { userId: order.customerId }, update: {}, create: { userId: order.customerId } });
      const points = Math.floor(Number(order.subtotal) / 100) * 5;
      if (points > 0) {
        await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { increment: points }, lifetimeEarn: { increment: points } } });
        await tx.loyaltyTransaction.create({ data: { accountId: account.id, orderId, type: 'EARN', points } });
      }
      // Mark assignment delivered
      const a = await tx.riderAssignment.findUnique({ where: { orderId } });
      if (a && a.status !== AssignmentStatus.DELIVERED) {
        await tx.riderAssignment.update({ where: { id: a.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
        await tx.riderProfile.update({ where: { id: a.riderId }, data: { currentLoad: { decrement: 1 }, totalDeliveries: { increment: 1 } } });
      }
    }
    return u;
  });

  publish(`order:${orderId}`, { kind: 'status', orderId, status: next, at: new Date().toISOString() });
  publish(`branch:${order.branchId}:orders`, { kind: 'status', orderId, status: next, at: new Date().toISOString() });
  // Mirror the status change to the group channel for the parent's unified board.
  const transRootId = order.branch.restaurant?.parentId ?? order.branch.restaurantId;
  publish(groupOrderChannel(transRootId), { kind: 'status', orderId, status: next, at: new Date().toISOString() });
  // OUT_FOR_DELIVERY → send the customer their delivery OTP via SMS so they
  // can hand it to the rider at the door. Fire-and-forget: a notification
  // failure must never roll back or block the transition. The previous-state
  // guard is implicit — transitionOrder early-returns when status === next.
  if (next === OrderStatus.OUT_FOR_DELIVERY && order.fulfillmentType === FulfillmentType.DELIVERY) {
    sendDeliveryOtpSms(orderId).catch(() => {});
  }
  // When a DELIVERY order is ready, push to the platform-wide rider pool. PICKUP
  // and DINE_IN orders never need a rider — they're collected/served in-house —
  // so we skip all rider dispatch for them. A READY pickup order just waits at
  // the counter for the customer to collect (with their pickupCode).
  if (next === OrderStatus.READY && order.fulfillmentType === FulfillmentType.DELIVERY) {
    publish('rider:pool', { kind: 'order:new', orderId, branchId: order.branchId });
    // Push-notify online riders who have a registered device token. Best-effort
    // — a push failure must never roll back or block the transition.
    notifyRidersOfNewOrder(orderId).catch(() => {});
    // Batch-dispatch: if free rider capacity is tight, offer this order as an
    // append-to-route invitation to OUT_FOR_DELIVERY riders nearby. The engine
    // self-gates on capacity (returns {invited:0} when there are enough free
    // riders), so it's safe to call on every READY transition. Fire-and-forget.
    maybeOfferAsBatch(orderId).catch(() => {});
  }
  // Challenge progress refresh fires AFTER the order transition commits so a
  // challenge-update failure never rolls back a delivered order. The function
  // is idempotent — safe to retry from a queue if we add one later.
  if (next === OrderStatus.DELIVERED) {
    await refreshChallengeProgressForOrder(orderId).catch((e) =>
      log.error({ err: (e as Error).message, orderId }, 'challenge progress refresh failed')
    );
    // Commit any signup-bonus hold against this order — moves the pending
    // amount into `usedAmount` and decrements `remainingOrders`. Idempotent.
    await commitSignupBonusForOrder(orderId).catch((e) =>
      log.error({ err: (e as Error).message, orderId }, 'signup bonus commit failed')
    );
  }
  // Cancellation/refund — restore the signup-bonus hold so the customer can
  // re-use the credit on a future order. Idempotent and reversible-aware
  // (releases pending hold OR reverses a committed credit + restores order count).
  if (
    next === OrderStatus.CANCELLED ||
    next === OrderStatus.CANCELLED_BY_CUSTOMER ||
    next === OrderStatus.CANCELLED_BY_RESTAURANT ||
    next === OrderStatus.CANCELLED_BY_ADMIN ||
    next === OrderStatus.REFUNDED ||
    next === OrderStatus.PAYMENT_FAILED
  ) {
    await restoreSignupBonusForOrder(orderId).catch((e) =>
      log.error({ err: (e as Error).message, orderId }, 'signup bonus restore failed')
    );
    // Restore freebie stock so the gift becomes available to another order.
    if (order.freebieRuleId) {
      await restoreFreebieStock(order.freebieRuleId).catch((e) =>
        log.error({ err: (e as Error).message, orderId, ruleId: order.freebieRuleId }, 'freebie stock restore failed')
      );
    }
  }
  if (order.customer?.phone) {
    await notify.sms({
      to: order.customer.phone,
      userId: order.customer.id,
      template: `order.${next.toLowerCase()}`,
      restaurantId: order.branch.restaurantId,
      body: `${brand.name}: Order ${order.code} — ${STATUS_LABELS[next]}.`
    }).catch((e) => log.error({ err: (e as Error).message, orderId, next }, 'order status sms failed'));
  }
  log.info({ orderId, next }, 'order transitioned');
  return updated;
}
