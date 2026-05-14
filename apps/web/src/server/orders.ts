/**
 * Order machine + side effects.
 *
 * Single source of truth for status transitions. Every transition writes an
 * `OrderStatusEvent`, fires a realtime event on `order:{id}` and `branch:{branch}:orders`,
 * dispatches the appropriate customer notification, and updates ETA timestamps.
 */

import { OrderStatus, PaymentMethod, PaymentStatus, AssignmentStatus, Prisma } from '@prisma/client';
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
import { clampTwo } from '@/lib/utils';
import { loadRulesForRestaurant, priceForItem, priceForCombo } from './happy-hours';
import { refreshChallengeProgressForOrder } from './challenges';
import { previewSignupBonusForUser, holdSignupBonusForOrder, commitSignupBonusForOrder, restoreSignupBonusForOrder } from './signup-bonus';

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
  READY:                    [OrderStatus.RIDER_ASSIGNED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED],
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
  items: { menuItemId?: string; comboId?: string; quantity: number; notes?: string }[];
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
    select: { restaurantId: true }
  });
  const hhNow = new Date();
  const hhRules = branchWithRestaurant
    ? await loadRulesForRestaurant(branchWithRestaurant.restaurantId, hhNow)
    : [];
  // Track which happy-hour rule was applied to each line for the post-create
  // audit log. Map by index into `lines` so we can attribute savings back.
  const hhAppliedByLine: { ruleId: string; ruleName: string; originalPrice: number; effectivePrice: number; quantity: number }[] = [];

  const lines: { name: string; unitPrice: number; quantity: number; menuItemId?: string; categoryId?: string | null; comboId?: string; notes?: string }[] = [];
  for (const it of input.items) {
    if (it.menuItemId) {
      // Include the parent category + its availability rows so we can enforce
      // both the item-level and category-level windows in one round-trip.
      const m = await prisma.menuItem.findUniqueOrThrow({
        where: { id: it.menuItemId },
        include: { category: { include: { availabilities: true } } }
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
      // Apply happy-hour pricing. When no rule matches, effectivePrice === Number(m.price).
      const priced = priceForItem(
        { id: m.id, categoryId: m.category.id, price: Number(m.price) },
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
      lines.push({ name: m.name, unitPrice: priced.effectivePrice, quantity: it.quantity, menuItemId: m.id, categoryId: m.category.id, notes: it.notes });
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

  const priced = pricing({
    lines: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
    taxRatePct: branch.taxRatePct,
    baseDeliveryFee: Number(branch.baseDeliveryFee),
    perKmDeliveryFee: Number(branch.perKmDeliveryFee),
    branch: { lat: branch.latitude, lng: branch.longitude },
    delivery: address ? { lat: address.latitude, lng: address.longitude } : null,
    coupon,
    offers: offerRewards,
    walletApplied: input.walletApply ?? 0,
    loyaltyApplied: input.loyaltyApply ?? 0,
    signupBonusApplied: bonusPreview.appliedAmount
  });

  const order = await prisma.$transaction(async (tx) => {
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
        discountAmount: priced.discountAmount as any,
        walletApplied: priced.walletApplied as any,
        loyaltyApplied: priced.loyaltyApplied as any,
        signupBonusApplied: priced.signupBonusApplied as any,
        total: priced.total as any,
        paymentMethod: input.paymentMethod,
        customerNotes: input.customerNotes,
        deliveryOtp: genDeliveryOtp(),
        items: { create: lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice as any, quantity: l.quantity, notes: l.notes, menuItemId: l.menuItemId, comboId: l.comboId })) },
        statusEvents: { create: [{ status: OrderStatus.RECEIVED, note: 'Placed by customer' }] }
      }
    });
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

  // Realtime: surface to admin/kitchen
  publish(`branch:${branch.id}:orders`, { kind: 'order:new', orderId: order.id, branchId: branch.id });
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

  // Kick off payment if Razorpay
  if (input.paymentMethod === PaymentMethod.RAZORPAY) {
    const provider = await paymentProvider(branch.restaurantId);
    const pOrder = await provider.createOrder({
      orderId: order.id,
      amount: priced.total,
      currency: 'INR',
      customer: { name: customer?.name, phone: customer?.phone, email: customer?.email }
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: PaymentMethod.RAZORPAY,
        status: PaymentStatus.PENDING,
        amount: priced.total as any,
        currency: 'INR',
        providerName: pOrder.providerName,
        providerRef: pOrder.providerOrderId,
        providerData: pOrder.raw as any
      }
    });
    return { order, payment: pOrder };
  } else {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: input.paymentMethod,
        status: input.paymentMethod === PaymentMethod.COD ? PaymentStatus.PENDING : PaymentStatus.CAPTURED,
        amount: priced.total as any,
        currency: 'INR',
        providerName: input.paymentMethod === PaymentMethod.COD ? 'cod' : 'wallet'
      }
    });
    return { order, payment: null };
  }
}

export async function transitionOrder(orderId: string, next: OrderStatus, opts: { actorId?: string; note?: string } = {}) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { customer: true, branch: { select: { restaurantId: true } } }
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
  // When an order is ready, push to the platform-wide rider pool channel.
  if (next === OrderStatus.READY) {
    publish('rider:pool', { kind: 'order:new', orderId, branchId: order.branchId });
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
