/**
 * Offer engine — eligibility resolution + reward computation.
 *
 * Public surface (used by both the cart preview API and `createOrder`):
 *
 *   evaluateOffer(offer, ctx)
 *     → Returns { eligible: true, amountOff, breakdown } | { eligible: false, reason }
 *     Pure: no DB calls, no I/O. Caller supplies the customer context.
 *
 *   pickBestOffers(offers, ctx)
 *     → Filters to eligible, ranks by (priority DESC, amountOff DESC), and
 *       returns the best non-stackable winner OR the best stackable bundle.
 *
 *   loadAndApplyOffers(ctx, opts)
 *     → DB-aware wrapper for callers that only have a cart + customerId.
 *       Reads candidate offers, computes customer order count, runs the
 *       evaluator, and returns the same shape as `pickBestOffers`.
 *
 *   loadOfferByCode(code, ctx)
 *     → Look up a specific coupon-code offer and evaluate it. Used by the
 *       "I have a code" cart input.
 *
 *   recordRedemption(tx, offer, orderId, userId, amountOff, breakdown, channel)
 *     → Writes an OfferRedemption row and increments usedCount in a single
 *       transaction-friendly helper.
 *
 * Design rules:
 *   - The pricing layer keeps its existing legacy-Coupon path intact. Offers
 *     are layered on top so old promos still work and tests don't break.
 *   - Reward math is deterministic and rounded to 2dp via `clampTwo`.
 *   - Per-customer caps require knowing the customer's prior redemption count
 *     for this specific offer. The DB-aware wrapper fetches it efficiently;
 *     the pure evaluator just consumes the number you give it.
 *   - All money values are JS numbers throughout — Decimal columns are
 *     converted at the boundary.
 *
 * Note on terminology:
 *   - "Cart line" = an item the customer wants to order (one row per item)
 *   - "Eligible" = passes all gating rules
 *   - "Reward" = the ₹ amount actually discounted (after caps)
 */
import type { OfferType, ChannelScope } from '@prisma/client';
import { clampTwo } from '@/lib/utils';
import { prisma } from './db';

/**
 * Resolve the authoritative branch for an offer evaluation from the cart's menu
 * items. A MenuItem belongs to exactly one Branch, so the items themselves are
 * the source of truth for "which restaurant is this cart from" — far more
 * reliable than a client-supplied branchId, which can be stale, guessed, or
 * point at the wrong tenant in a multi-restaurant marketplace.
 *
 * Falls back to `fallbackBranchId` for carts with no resolvable menu items
 * (e.g. combo-only carts), and returns null if nothing resolves.
 */
export async function resolveCartBranch(
  menuItemIds: string[],
  fallbackBranchId?: string | null
): Promise<{ id: string; restaurantId: string } | null> {
  const ids = menuItemIds.filter(Boolean);
  if (ids.length > 0) {
    const item = await prisma.menuItem.findFirst({
      where: { id: { in: ids } },
      select: { branch: { select: { id: true, restaurantId: true } } }
    });
    if (item?.branch) return { id: item.branch.id, restaurantId: item.branch.restaurantId };
  }
  if (fallbackBranchId) {
    const b = await prisma.branch.findUnique({
      where: { id: fallbackBranchId },
      select: { id: true, restaurantId: true }
    });
    if (b) return b;
  }
  return null;
}

/**
 * Does a coupon with this code exist ANYWHERE (any restaurant)? Used to give a
 * precise "valid at a different restaurant" message instead of a flat "invalid"
 * when a customer pastes a code that doesn't belong to their cart's restaurant.
 */
export async function couponCodeExistsElsewhere(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;
  const now = new Date();
  const found = await (prisma as any).offer
    .findFirst({
      where: {
        code: { equals: trimmed, mode: 'insensitive' },
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }]
      },
      select: { id: true }
    })
    .catch(() => null);
  return Boolean(found);
}

// ── Public types ──────────────────────────────────────────────────────────

export interface OfferCartLine {
  menuItemId: string;
  categoryId?: string | null;
  unitPrice: number;
  quantity: number;
  /** Optional name for breakdown logs */
  name?: string;
}

export interface OfferContext {
  cart: OfferCartLine[];
  subtotal: number;
  /** Channel the order is being placed on. */
  channel: 'ONLINE' | 'DINE_IN';
  /** Fulfillment type of the order (delivery/pickup/dine-in). When provided and
   *  an offer sets `fulfillmentScope`, the offer only fires for matching types.
   *  Left null on the storefront carousel preview (so promos still display). */
  fulfillmentType?: 'DELIVERY' | 'PICKUP' | 'DINE_IN' | null;
  /** Already-resolved branchId of the cart's branch (offers can scope here). */
  branchId: string | null;
  restaurantId: string | null;
  /** Number of *completed* prior orders for this customer (used by FIRST_ORDER + REPEAT_CUSTOMER). */
  customerOrderCount: number;
  /** Number of times this specific customer has previously redeemed THIS offer. */
  customerRedemptionsForOffer?: number;
  /** UTC now — injected for test determinism. */
  now?: Date;
}

export interface OfferEvalSuccess {
  eligible: true;
  amountOff: number;
  /** Which items get a free/discounted portion. Empty for non-item-targeted offers. */
  affectedItemIds: string[];
  breakdown: Record<string, unknown>;
}
export interface OfferEvalFailure {
  eligible: false;
  reason: string;
}
export type OfferEvalResult = OfferEvalSuccess | OfferEvalFailure;

/** Loose Offer shape that matches what prisma.offer.findMany() returns. We
 *  avoid importing the full generated type so the same helper is callable
 *  from unit tests with a hand-rolled fixture. */
export interface OfferRow {
  id: string;
  name: string;
  type: OfferType;
  code: string | null;
  percentOff: number | null;
  flatOff: any;
  maxDiscount: any;
  minOrderAmount: any;
  rewardConfig: any;
  restaurantId: string | null;
  branchId: string | null;
  appliesToCategories?: { categoryId: string }[];
  appliesToItems?: { menuItemId: string }[];
  issuedChannel: ChannelScope;
  redeemChannel: ChannelScope;
  minCustomerOrders: number;
  validFrom: Date | string;
  validTo: Date | string | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
  priority: number;
  autoApply: boolean;
  stackable: boolean;
  /** Fulfillment targeting — empty/undefined ⇒ all types. */
  fulfillmentScope?: ('DELIVERY' | 'PICKUP' | 'DINE_IN')[] | null;
  /** Recurring day/time windows — empty/undefined ⇒ active any time in validity. */
  schedules?: { dayOfWeek: number; startMin: number; endMin: number }[] | null;
}

/** Mark task #345 BOGO config shape (stored in Offer.rewardConfig JSON). */
export interface BogoConfig {
  buyQty?: number;
  getQty?: number;
  buyScope?: 'ALL' | 'CATEGORY' | 'ITEMS';
  buyCategoryIds?: string[];
  buyItemIds?: string[];
  getScope?: 'ALL' | 'CATEGORY' | 'ITEMS';
  getCategoryIds?: string[];
  getItemIds?: string[];
  /** Discount applied to each qualifying "get" unit. */
  getDiscountType?: 'PERCENT' | 'FIXED' | 'FIXED_PRICE';
  getDiscountValue?: number; // pct 1..100 | ₹ off per unit | ₹ fixed price
  /** Which get-units to discount when more qualify than free slots. */
  getItemSelect?: 'LOWER' | 'HIGHER' | 'SAME';
  // ── Legacy single-item shape (still honoured) ──
  buyItemId?: string;
  getItemId?: string;
  getDiscountPct?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function num(v: any, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ok(amountOff: number, affectedItemIds: string[], breakdown: Record<string, unknown>): OfferEvalSuccess {
  return { eligible: true, amountOff: clampTwo(Math.max(0, amountOff)), affectedItemIds, breakdown };
}
function no(reason: string): OfferEvalFailure {
  return { eligible: false, reason };
}

/**
 * Are the items in `cart` allowed by this offer's scope? An offer with no
 * category/item scopes is unrestricted (works against the whole cart). When
 * scopes are set, only matching lines count toward the offer.
 *
 * Returns the qualifying subset and its subtotal so callers can compute a
 * scope-restricted reward (e.g. "20% off desserts" only discounts dessert
 * lines).
 */
function scopedLines(offer: OfferRow, cart: OfferCartLine[]): { lines: OfferCartLine[]; subtotal: number } {
  const cats = new Set((offer.appliesToCategories ?? []).map((c) => c.categoryId));
  const items = new Set((offer.appliesToItems ?? []).map((i) => i.menuItemId));
  if (cats.size === 0 && items.size === 0) {
    return { lines: cart, subtotal: cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0) };
  }
  const filtered = cart.filter((l) => items.has(l.menuItemId) || (l.categoryId && cats.has(l.categoryId)));
  return { lines: filtered, subtotal: filtered.reduce((s, l) => s + l.unitPrice * l.quantity, 0) };
}

// ── BOGO (Buy-X-Get-Y) computation ──────────────────────────────────────────

type BogoScope = 'ALL' | 'CATEGORY' | 'ITEMS';

function bogoMatch(line: { menuItemId: string; categoryId?: string | null }, scope: BogoScope, catIds: Set<string>, itemIds: Set<string>): boolean {
  if (scope === 'ALL') return true;
  if (scope === 'ITEMS') return itemIds.has(line.menuItemId);
  return Boolean(line.categoryId && catIds.has(line.categoryId)); // CATEGORY
}

interface BogoUnit { menuItemId: string; price: number; categoryId?: string | null }

/**
 * Full Buy-X-Get-Y resolver supporting:
 *  - buy/get targeting by ALL, CATEGORY, or specific ITEMS
 *  - buyQty / getQty (e.g. BUY 2 GET 2)
 *  - get discount as PERCENT (1..100, default 100 = free), FIXED (₹ off per
 *    unit) or FIXED_PRICE (unit now costs ₹X)
 *  - getItemSelect = LOWER (cheapest qualifying get-units, the standard BOGO),
 *    HIGHER (priciest), or SAME (the get-unit's item must also be buy-eligible)
 *  - overlapping pools (buy & get target the same items, e.g. BUY 1 GET 1 on a
 *    whole category) handled via chunk allocation so a unit is never both paid
 *    and free; disjoint pools (item A → item B) handled via set counting.
 * Legacy single-item config { buyItemId, getItemId, getDiscountPct } still works.
 */
function computeBogo(cfgRaw: any, cart: OfferCartLine[], maxCap: number): OfferEvalResult {
  const cfg = (cfgRaw ?? {}) as BogoConfig;

  // Normalise legacy single-item config into the scope-based shape.
  const buyScope = (cfg.buyScope ?? (cfg.buyItemId ? 'ITEMS' : 'ALL')) as BogoScope;
  const getScope = (cfg.getScope ?? (cfg.getItemId ? 'ITEMS' : buyScope)) as BogoScope;
  const buyItemIds = new Set<string>(cfg.buyItemIds ?? (cfg.buyItemId ? [cfg.buyItemId] : []));
  const getItemIds = new Set<string>(cfg.getItemIds ?? (cfg.getItemId ? [cfg.getItemId] : []));
  const buyCatIds = new Set<string>(cfg.buyCategoryIds ?? []);
  const getCatIds = new Set<string>(cfg.getCategoryIds ?? []);

  const buyQty = Math.max(1, Math.floor(Number(cfg.buyQty ?? 1)));
  const getQty = Math.max(1, Math.floor(Number(cfg.getQty ?? 1)));
  const discType = (cfg.getDiscountType ?? 'PERCENT') as 'PERCENT' | 'FIXED' | 'FIXED_PRICE';
  const rawVal = Number(cfg.getDiscountValue ?? cfg.getDiscountPct ?? (discType === 'PERCENT' ? 100 : 0));
  const select = (cfg.getItemSelect ?? 'LOWER') as 'LOWER' | 'HIGHER' | 'SAME';

  // Validation per discount type.
  if (discType === 'PERCENT' && (rawVal <= 0 || rawVal > 100)) return no('BOGO percent must be 1–100');
  if ((discType === 'FIXED' || discType === 'FIXED_PRICE') && rawVal < 0) return no('BOGO amount misconfigured');
  if (buyScope === 'ITEMS' && buyItemIds.size === 0) return no('BOGO buy items not set');
  if (getScope === 'ITEMS' && getItemIds.size === 0) return no('BOGO get items not set');
  if (buyScope === 'CATEGORY' && buyCatIds.size === 0) return no('BOGO buy category not set');
  if (getScope === 'CATEGORY' && getCatIds.size === 0) return no('BOGO get category not set');

  // Expand cart into individual units.
  const units: BogoUnit[] = [];
  for (const l of cart) {
    for (let i = 0; i < l.quantity; i++) units.push({ menuItemId: l.menuItemId, price: l.unitPrice, categoryId: l.categoryId });
  }
  const isBuy = (u: BogoUnit) => bogoMatch(u, buyScope, buyCatIds, buyItemIds);
  const isGet = (u: BogoUnit) => bogoMatch(u, getScope, getCatIds, getItemIds);
  const buyUnits = units.filter(isBuy);
  let getUnits = units.filter(isGet);
  if (buyUnits.length === 0) return no(`add ${buyQty} qualifying item(s) to unlock this deal`);

  const overlap = units.some((u) => isBuy(u) && isGet(u));

  // SAME: the discounted get-unit's item must also be buy-eligible.
  if (select === 'SAME') {
    const buyItemSet = new Set(buyUnits.map((u) => u.menuItemId));
    getUnits = getUnits.filter((u) => buyItemSet.has(u.menuItemId));
  }

  // Decide how many get-units are discounted.
  let discountCount: number;
  if (overlap) {
    // Same/overlapping pool — pay buyQty, discount getQty per chunk so a unit is
    // never both paid and free. Sets bounded by the get-eligible pool size.
    const chunk = buyQty + getQty;
    const sets = Math.floor(getUnits.length / chunk);
    discountCount = sets * getQty;
  } else {
    // Disjoint pools — each buyQty of buy-units unlocks getQty get-units.
    const sets = Math.floor(buyUnits.length / buyQty);
    discountCount = Math.min(getUnits.length, sets * getQty);
  }
  if (discountCount <= 0) return no(`add more qualifying items to claim the deal`);

  // Select which get-units get the discount.
  const sorted = [...getUnits].sort((a, b) => (select === 'HIGHER' ? b.price - a.price : a.price - b.price));
  const chosen = sorted.slice(0, discountCount);

  const perUnit = (price: number) =>
    discType === 'PERCENT' ? price * (rawVal / 100)
    : discType === 'FIXED' ? Math.min(price, rawVal)
    : /* FIXED_PRICE */ Math.max(0, price - rawVal);

  const raw = chosen.reduce((s, u) => s + perUnit(u.price), 0);
  const amt = Math.min(raw, maxCap);
  const affected = Array.from(new Set(chosen.map((u) => u.menuItemId)));
  return ok(amt, affected, {
    type: 'BUY_X_GET_Y',
    buyScope, getScope, buyQty, getQty, getDiscountType: discType, getDiscountValue: rawVal, getItemSelect: select,
    discountedUnits: chosen.length, overlap, raw
  });
}

// ── Gating ────────────────────────────────────────────────────────────────

function checkGates(offer: OfferRow, ctx: OfferContext): OfferEvalFailure | null {
  if (!offer.isActive) return no('offer is inactive');
  const now = ctx.now ?? new Date();
  const from = new Date(offer.validFrom);
  if (now < from) return no('offer has not started yet');
  if (offer.validTo && now > new Date(offer.validTo)) return no('offer has expired');

  if (offer.usageLimit != null && offer.usedCount >= offer.usageLimit) return no('offer usage limit reached');
  if ((ctx.customerRedemptionsForOffer ?? 0) >= offer.perUserLimit) return no('per-customer limit reached');

  // Channel checks: redeemChannel constrains where the offer can be used.
  if (offer.redeemChannel !== 'ANY' && offer.redeemChannel !== ctx.channel) {
    return no(`offer is only redeemable on ${offer.redeemChannel}`);
  }

  // Restaurant/branch scope
  if (offer.restaurantId && ctx.restaurantId !== offer.restaurantId) return no('offer is for a different restaurant');
  if (offer.branchId && ctx.branchId !== offer.branchId) return no('offer is for a different branch');

  // Fulfillment targeting (delivery/pickup/dine-in). Only gates when the offer
  // restricts AND the caller supplied a fulfillment type (storefront preview
  // leaves it null so promos still display).
  const fScope = offer.fulfillmentScope ?? [];
  if (fScope.length > 0 && ctx.fulfillmentType && !fScope.includes(ctx.fulfillmentType)) {
    return no(`offer is only valid for ${fScope.join(' / ').toLowerCase()} orders`);
  }

  // Recurring day/time windows. No schedule rows ⇒ always in-window. Otherwise
  // "now" must fall inside one of the windows for the matching weekday.
  const schedules = offer.schedules ?? [];
  if (schedules.length > 0) {
    const dow = now.getDay(); // 0..6 Sun..Sat
    const mins = now.getHours() * 60 + now.getMinutes();
    const inWindow = schedules.some(
      (s) => s.dayOfWeek === dow && mins >= s.startMin && mins < s.endMin
    );
    if (!inWindow) return no('offer is outside its active hours');
  }

  // Min order amount (gate on whole cart subtotal — even if scope is partial)
  const minOrder = num(offer.minOrderAmount, 0);
  if (minOrder > 0 && ctx.subtotal < minOrder) return no(`cart subtotal must be at least ₹${minOrder}`);

  // Customer lifecycle gates
  if (offer.type === 'FIRST_ORDER' && ctx.customerOrderCount > 0) return no('first-order offer — customer already ordered');
  if (offer.type === 'REPEAT_CUSTOMER' && ctx.customerOrderCount < (offer.minCustomerOrders || 1)) {
    return no(`offer requires at least ${offer.minCustomerOrders || 1} prior order(s)`);
  }
  if (offer.type === 'DINE_IN_TO_ONLINE' && ctx.channel !== 'ONLINE') return no('redeem online only');
  if (offer.type === 'ONLINE_TO_DINE_IN' && ctx.channel !== 'DINE_IN') return no('redeem in-restaurant only');

  return null;
}

// ── Per-type evaluators ───────────────────────────────────────────────────

/**
 * Compute the discount this offer would apply to the supplied cart, assuming
 * gating already passed (the caller invokes `checkGates` first).
 */
function evaluateReward(offer: OfferRow, ctx: OfferContext): OfferEvalResult {
  const cfg = offer.rewardConfig ?? {};
  const maxCap = num(offer.maxDiscount, Infinity);

  switch (offer.type) {
    case 'PERCENTAGE': {
      const { lines, subtotal } = scopedLines(offer, ctx.cart);
      if (subtotal <= 0) return no('no eligible items in cart');
      const pct = num(offer.percentOff, 0);
      if (pct <= 0) return no('offer has no percentage configured');
      const raw = subtotal * (pct / 100);
      const amt = Math.min(raw, maxCap);
      return ok(amt, lines.map((l) => l.menuItemId), { type: 'PERCENTAGE', percentOff: pct, scopedSubtotal: subtotal, raw, capped: amt < raw });
    }

    case 'FIXED':
    case 'FIRST_ORDER':
    case 'REPEAT_CUSTOMER':
    case 'DINE_IN_TO_ONLINE':
    case 'ONLINE_TO_DINE_IN': {
      // Flat-off types — the lifecycle types reuse the same shape and just gate differently.
      // Allow either flatOff or percentOff with cap so admin can pick FIRST_ORDER + 20%.
      const { lines, subtotal } = scopedLines(offer, ctx.cart);
      if (subtotal <= 0) return no('no eligible items in cart');
      let raw = num(offer.flatOff, 0);
      if (raw === 0 && offer.percentOff) raw = subtotal * (num(offer.percentOff, 0) / 100);
      if (raw <= 0) return no('offer has no discount configured');
      const amt = Math.min(raw, maxCap, subtotal);
      return ok(amt, lines.map((l) => l.menuItemId), { type: offer.type, raw });
    }

    case 'BUY_X_GET_Y':
      // Full BOGO: category/item buy+get scopes, qty, %/₹/fixed-price discount,
      // lower/higher/same selection. Legacy single-item config still honoured.
      return computeBogo(cfg, ctx.cart, maxCap);

    case 'COMBO_DISCOUNT': {
      // cfg: { items: [{ id, qty }], comboPrice }
      // Customer must have ALL listed items at ≥ specified qty. Discount =
      // (sum of regular prices for the bundle) − comboPrice.
      const items: { id: string; qty: number }[] = Array.isArray(cfg.items) ? cfg.items : [];
      const comboPrice = num(cfg.comboPrice, 0);
      if (items.length === 0 || comboPrice <= 0) return no('combo discount misconfigured');

      const cartByItem = new Map(ctx.cart.map((l) => [l.menuItemId, l]));
      let regularTotal = 0;
      for (const need of items) {
        const have = cartByItem.get(need.id);
        if (!have || have.quantity < need.qty) return no(`combo requires ${need.qty}× of each item`);
        regularTotal += have.unitPrice * need.qty;
      }
      const raw = Math.max(0, regularTotal - comboPrice);
      const amt = Math.min(raw, maxCap);
      return ok(amt, items.map((i) => i.id), { type: 'COMBO_DISCOUNT', regularTotal, comboPrice, raw });
    }

    case 'FREE_ITEM_ABOVE': {
      // cfg: { itemId, threshold }
      const itemId = String(cfg.itemId ?? '');
      const threshold = num(cfg.threshold, 0);
      if (!itemId || threshold <= 0) return no('free-item offer misconfigured');
      if (ctx.subtotal < threshold) return no(`add ₹${threshold - ctx.subtotal} more to qualify`);
      const line = ctx.cart.find((l) => l.menuItemId === itemId);
      if (!line) return no('add the gift item to your cart to claim');
      // Discount = price of ONE unit of the gift item.
      const amt = Math.min(line.unitPrice, maxCap);
      return ok(amt, [itemId], { type: 'FREE_ITEM_ABOVE', itemId, threshold, unitPrice: line.unitPrice });
    }

    default:
      return no(`unknown offer type ${offer.type}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function evaluateOffer(offer: OfferRow, ctx: OfferContext): OfferEvalResult {
  const gate = checkGates(offer, ctx);
  if (gate) return gate;
  return evaluateReward(offer, ctx);
}

/**
 * Rank a set of offers and pick the best winning combination for the cart.
 *
 * Non-stackable wins:    one offer, highest priority, then highest amountOff.
 * Stackable wins:        sum of all stackable offers whose discounts don't
 *                        target the same cart line (we keep the first that
 *                        claims a line, drop the rest). Falls back to the
 *                        best non-stackable if the bundle is worth less.
 */
export interface PickResult {
  winners: { offer: OfferRow; result: OfferEvalSuccess }[];
  totalAmountOff: number;
  /** All eligibility outcomes, so the UI can show "why not?" messages. */
  evaluations: { offer: OfferRow; result: OfferEvalResult }[];
}

export function pickBestOffers(offers: OfferRow[], ctx: OfferContext): PickResult {
  const evaluations = offers.map((offer) => ({ offer, result: evaluateOffer(offer, ctx) }));
  const eligible = evaluations.filter((e) => e.result.eligible) as { offer: OfferRow; result: OfferEvalSuccess }[];

  if (eligible.length === 0) return { winners: [], totalAmountOff: 0, evaluations };

  // Sort by priority desc, then amountOff desc.
  eligible.sort((a, b) => (b.offer.priority - a.offer.priority) || (b.result.amountOff - a.result.amountOff));

  const bestSingle = eligible[0];

  // Build a stackable bundle (greedy by sorted order, skip if any line conflicts).
  const claimedLines = new Set<string>();
  const stackBundle: typeof eligible = [];
  let stackTotal = 0;
  for (const e of eligible) {
    if (!e.offer.stackable) continue;
    // Allow a stackable offer in only if it doesn't touch a previously-claimed line.
    if (e.result.affectedItemIds.some((id) => claimedLines.has(id))) continue;
    stackBundle.push(e);
    e.result.affectedItemIds.forEach((id) => claimedLines.add(id));
    stackTotal += e.result.amountOff;
  }
  stackTotal = clampTwo(stackTotal);

  if (stackTotal > bestSingle.result.amountOff && stackBundle.length > 1) {
    return { winners: stackBundle, totalAmountOff: stackTotal, evaluations };
  }
  return { winners: [bestSingle], totalAmountOff: bestSingle.result.amountOff, evaluations };
}

/**
 * DB-aware wrapper. Loads candidate offers (active, in-window, scoped to the
 * cart's restaurant/branch or platform-wide), counts the customer's prior
 * redemptions per offer in a single grouped query, evaluates them, and picks
 * the winning combination.
 *
 *  opts.code      → if supplied, ONLY this code is considered (manual entry)
 *  opts.autoOnly  → consider only autoApply=true offers (for cart preview)
 *  opts.includeAll → include code-only + autoApply offers (full list endpoint)
 */
export interface LoadAndApplyOpts {
  code?: string;
  autoOnly?: boolean;
  includeAll?: boolean;
}

export async function loadAndApplyOffers(
  ctx: Omit<OfferContext, 'customerOrderCount' | 'customerRedemptionsForOffer'> & { customerId: string | null },
  opts: LoadAndApplyOpts = {}
): Promise<PickResult & { customerOrderCount: number }> {
  const now = ctx.now ?? new Date();

  // 1. Customer lifecycle: count completed prior orders so FIRST_ORDER and
  //    REPEAT_CUSTOMER gates can be evaluated.
  let customerOrderCount = 0;
  if (ctx.customerId) {
    customerOrderCount = await prisma.order.count({
      where: {
        customerId: ctx.customerId,
        status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] }
      }
    });
  }

  // 2. Candidate offers: active, in-window, scoped to this restaurant or platform-wide.
  const whereScope: any = {
    isActive: true,
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gt: now } }],
    AND: [
      { OR: [{ restaurantId: null }, { restaurantId: ctx.restaurantId ?? undefined }] },
      { OR: [{ branchId: null }, { branchId: ctx.branchId ?? undefined }] }
    ]
  };
  if (opts.code) whereScope.code = opts.code;
  else if (opts.autoOnly) whereScope.autoApply = true;
  else if (!opts.includeAll) whereScope.OR = [{ autoApply: true }, { code: { not: null } }];

  const offers = await prisma.offer.findMany({
    where: whereScope,
    include: { appliesToCategories: true, appliesToItems: true, schedules: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  // 3. Per-customer redemption counts (so perUserLimit gates correctly).
  let redemptionsByOffer = new Map<string, number>();
  if (ctx.customerId && offers.length > 0) {
    const rows = await prisma.offerRedemption.groupBy({
      by: ['offerId'],
      where: { userId: ctx.customerId, offerId: { in: offers.map((o) => o.id) } },
      _count: { offerId: true }
    });
    redemptionsByOffer = new Map(rows.map((r) => [r.offerId, r._count.offerId]));
  }

  // 4. Evaluate each offer with the enriched context.
  const enriched = offers.map((o) => ({ ...o, customerOrderCount }));
  const picked = pickBestOffers(enriched as unknown as OfferRow[], {
    cart: ctx.cart,
    subtotal: ctx.subtotal,
    channel: ctx.channel,
    fulfillmentType: ctx.fulfillmentType ?? null,
    branchId: ctx.branchId,
    restaurantId: ctx.restaurantId,
    customerOrderCount,
    customerRedemptionsForOffer: 0, // overridden per-offer below
    now
  });

  // The pure picker doesn't know per-offer redemption counts — fix up by
  // re-running gate checks for the perUserLimit on each winner. Anything
  // that fails gets dropped.
  const filteredWinners = picked.winners.filter((w) => {
    const count = redemptionsByOffer.get(w.offer.id) ?? 0;
    if (count >= w.offer.perUserLimit) return false;
    return true;
  });

  const totalAmountOff = filteredWinners.reduce((s, w) => s + w.result.amountOff, 0);

  // Re-attach customerRedemptionsForOffer to each evaluation entry for UI.
  const annotatedEvals = picked.evaluations.map((e) => ({
    offer: e.offer,
    result: e.result,
    customerRedemptions: redemptionsByOffer.get(e.offer.id) ?? 0
  }));

  return {
    winners: filteredWinners,
    totalAmountOff: clampTwo(totalAmountOff),
    evaluations: annotatedEvals as any,
    customerOrderCount
  };
}

/**
 * Look up an offer by user-typed code. Returns the eligibility result (so the
 * cart UI can surface "expired" / "min order ₹500" feedback) instead of just
 * silently failing.
 */
export async function loadOfferByCode(code: string, ctx: Omit<OfferContext, 'customerOrderCount' | 'customerRedemptionsForOffer'> & { customerId: string | null }) {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;
  const r = await loadAndApplyOffers(ctx, { code: trimmed });
  // With code: ONLY one offer in `offers`. If it's eligible, returns one
  // winner; otherwise the evaluation tells us why.
  return {
    winner: r.winners[0] ?? null,
    evaluation: r.evaluations[0] ?? null,
    customerOrderCount: r.customerOrderCount
  };
}

/**
 * Write redemption rows + increment usedCount on the offer atomically. Call
 * inside the same `prisma.$transaction` as the order creation.
 */
export async function recordRedemption(
  tx: any,
  offerId: string,
  orderId: string,
  userId: string,
  amountOff: number,
  breakdown: Record<string, unknown> | null,
  channel: 'ONLINE' | 'DINE_IN'
) {
  await tx.offerRedemption.create({
    data: { offerId, orderId, userId, amountOff: amountOff as any, breakdown: breakdown ?? undefined, channel }
  });
  await tx.offer.update({ where: { id: offerId }, data: { usedCount: { increment: 1 } } });
}
