/**
 * Happy Hour pricing resolver.
 *
 * Mirrors the architecture of `category-availability.ts` (pure functions over
 * lite snapshots, time injected for tests) plus a small DB-aware loader.
 *
 * Public surface:
 *
 *   isRuleInWindowNow(rule, now)
 *     → returns whether the rule's day/time schedule includes `now`. A rule
 *       with no schedule rows is treated as always-in-window (within its
 *       validFrom..validTo range) — the admin UI surfaces this with a
 *       warning so admins don't accidentally publish a 24/7 happy hour.
 *
 *   ruleAppliesToItem(rule, item)      / ruleAppliesToCombo(rule, combo)
 *     → scope test for RESTAURANT / CATEGORY / MENU_ITEM / COMBO scopes.
 *
 *   priceForItem(item, candidateRules, now)
 *     → { originalPrice, effectivePrice, savings, rule } for a single menu
 *       item. Returns the *winning* rule when multiple match (priority DESC,
 *       savings DESC, specificity DESC: ITEM > CATEGORY > RESTAURANT).
 *
 *   priceForCombo(combo, candidateRules, now)
 *     → same shape; ITEM-scoped rules are ignored here.
 *
 *   lifecycleBucket(rule, now)
 *     → 'active' | 'upcoming' | 'expired' — drives the admin tabs.
 *
 *   loadRulesForRestaurant(restaurantId, now)
 *     → DB-aware: returns active+in-validity rules with their schedules. Use
 *       this once at the top of a render or order-place call, then thread the
 *       same `rules` array into the pure helpers below to keep things fast.
 *
 * Design notes:
 *   - All money is JS numbers throughout; Decimal columns are converted at
 *     the boundary. We clamp results to 2dp with `clampTwo`.
 *   - `priceForItem` always returns `effectivePrice ≥ minPrice` if minPrice
 *     is set (safety floor for high-percentage rules).
 *   - We compose with the existing Offer engine cleanly: Happy Hours rewrite
 *     the per-line `unitPrice`, then offers run on the new subtotal. That
 *     means a 50% happy hour + 10% offer = customers pay 45% of original on
 *     impacted lines, which matches how restaurants tend to think about
 *     "double discount" promos.
 */
import { clampTwo } from '@/lib/utils';
import { prisma } from './db';
import type { HappyHourScope, HappyHourDiscountType } from '@prisma/client';

// ── Public types ──────────────────────────────────────────────────────────

export interface HappyHourScheduleRow {
  dayOfWeek: number; // 0..6
  startMin:  number; // 0..1440 inclusive
  endMin:    number; // 0..1440 exclusive
}

export interface HappyHourRuleLite {
  id: string;
  name: string;
  scope: HappyHourScope;
  categoryId: string | null;
  menuItemId: string | null;
  comboId: string | null;
  discountType: HappyHourDiscountType;
  percentOff: number | null;
  fixedPrice: number | string | null; // Decimal — coerced
  amountOff:  number | string | null;
  minPrice:   number | string | null;
  validFrom:  Date | string;
  validTo:    Date | string | null;
  isActive:   boolean;
  priority:   number;
  schedules:  HappyHourScheduleRow[];
}

export interface PricedItem {
  originalPrice: number;
  effectivePrice: number;
  savings: number;
  /** The winning rule (or null when no rule applied). */
  rule: HappyHourRuleLite | null;
  /** Short label suitable for a UI chip ("HAPPY HOUR · 20% off"). */
  label: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function num(v: any, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Specificity score — higher = more specific scope wins ties. */
function specificityScore(rule: HappyHourRuleLite): number {
  switch (rule.scope) {
    case 'MENU_ITEM': return 3;
    case 'COMBO':     return 3;
    case 'CATEGORY':  return 2;
    case 'RESTAURANT':return 1;
    default:          return 0;
  }
}

// ── Window check ──────────────────────────────────────────────────────────

export function isRuleInWindowNow(rule: HappyHourRuleLite, now: Date = new Date()): boolean {
  if (!rule.isActive) return false;
  const from = new Date(rule.validFrom);
  if (now < from) return false;
  if (rule.validTo && now > new Date(rule.validTo)) return false;
  // No schedule rows ⇒ always in window during the validity range.
  if (!rule.schedules || rule.schedules.length === 0) return true;
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const s of rule.schedules) {
    if (s.dayOfWeek === day && mins >= s.startMin && mins < s.endMin) return true;
  }
  return false;
}

// ── Lifecycle bucketing for the admin "Active / Upcoming / Expired" tabs ──

export type LifecycleBucket = 'active' | 'upcoming' | 'expired';

export function lifecycleBucket(rule: HappyHourRuleLite, now: Date = new Date()): LifecycleBucket {
  if (rule.validTo && now > new Date(rule.validTo)) return 'expired';
  if (now < new Date(rule.validFrom)) return 'upcoming';
  if (!rule.isActive) return 'expired'; // toggled off — surface in Expired tab
  return 'active';
}

// ── Scope tests ───────────────────────────────────────────────────────────

export interface ItemLite { id: string; categoryId: string | null; price: number | string; }
export interface ComboLite { id: string; price: number | string; }

export function ruleAppliesToItem(rule: HappyHourRuleLite, item: ItemLite): boolean {
  switch (rule.scope) {
    case 'RESTAURANT': return true;
    case 'CATEGORY':   return !!rule.categoryId && rule.categoryId === item.categoryId;
    case 'MENU_ITEM':  return !!rule.menuItemId && rule.menuItemId === item.id;
    case 'COMBO':      return false; // a combo-scoped rule never applies to individual menu items
    default:           return false;
  }
}

export function ruleAppliesToCombo(rule: HappyHourRuleLite, combo: ComboLite): boolean {
  switch (rule.scope) {
    case 'RESTAURANT': return true;
    case 'COMBO':      return !!rule.comboId && rule.comboId === combo.id;
    // CATEGORY / MENU_ITEM are irrelevant for combo pricing
    default:           return false;
  }
}

// ── Reward computation ───────────────────────────────────────────────────

function computeNewPrice(rule: HappyHourRuleLite, original: number): number {
  let next = original;
  switch (rule.discountType) {
    case 'PERCENTAGE': {
      const pct = num(rule.percentOff, 0);
      next = original * (1 - pct / 100);
      break;
    }
    case 'FIXED_PRICE': {
      next = num(rule.fixedPrice, original);
      break;
    }
    case 'FIXED_AMOUNT_OFF': {
      next = original - num(rule.amountOff, 0);
      break;
    }
  }
  // Apply floor + clamp to 2dp.
  const floor = rule.minPrice == null ? 0 : num(rule.minPrice, 0);
  if (next < floor) next = floor;
  if (next < 0) next = 0;
  // A "discount" that actually raises the price is treated as no-op.
  if (next > original) next = original;
  return clampTwo(next);
}

function buildLabel(rule: HappyHourRuleLite): string {
  switch (rule.discountType) {
    case 'PERCENTAGE':
      return `Happy Hour · ${num(rule.percentOff, 0)}% off`;
    case 'FIXED_PRICE':
      return `Happy Hour · ₹${num(rule.fixedPrice, 0)}`;
    case 'FIXED_AMOUNT_OFF':
      return `Happy Hour · ₹${num(rule.amountOff, 0)} off`;
    default:
      return 'Happy Hour';
  }
}

// ── Winning-rule picker ───────────────────────────────────────────────────

function pickWinner(applicable: { rule: HappyHourRuleLite; effective: number }[], original: number): { rule: HappyHourRuleLite; effective: number } | null {
  if (applicable.length === 0) return null;
  // Rank: (1) higher savings, (2) higher priority, (3) higher specificity.
  // Larger savings should usually win for the customer — but if the admin
  // explicitly sets a `priority` they intend to override that.
  applicable.sort((a, b) => {
    const savA = original - a.effective;
    const savB = original - b.effective;
    if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
    if (savA !== savB) return savB - savA;
    return specificityScore(b.rule) - specificityScore(a.rule);
  });
  return applicable[0];
}

// ── Public pricing API ───────────────────────────────────────────────────

export function priceForItem(item: ItemLite, candidateRules: HappyHourRuleLite[], now: Date = new Date()): PricedItem {
  const original = clampTwo(num(item.price, 0));
  const applicable: { rule: HappyHourRuleLite; effective: number }[] = [];
  for (const r of candidateRules) {
    if (!ruleAppliesToItem(r, item)) continue;
    if (!isRuleInWindowNow(r, now)) continue;
    applicable.push({ rule: r, effective: computeNewPrice(r, original) });
  }
  const winner = pickWinner(applicable, original);
  if (!winner) {
    return { originalPrice: original, effectivePrice: original, savings: 0, rule: null, label: null };
  }
  return {
    originalPrice: original,
    effectivePrice: winner.effective,
    savings: clampTwo(Math.max(0, original - winner.effective)),
    rule: winner.rule,
    label: buildLabel(winner.rule)
  };
}

export function priceForCombo(combo: ComboLite, candidateRules: HappyHourRuleLite[], now: Date = new Date()): PricedItem {
  const original = clampTwo(num(combo.price, 0));
  const applicable: { rule: HappyHourRuleLite; effective: number }[] = [];
  for (const r of candidateRules) {
    if (!ruleAppliesToCombo(r, combo)) continue;
    if (!isRuleInWindowNow(r, now)) continue;
    applicable.push({ rule: r, effective: computeNewPrice(r, original) });
  }
  const winner = pickWinner(applicable, original);
  if (!winner) {
    return { originalPrice: original, effectivePrice: original, savings: 0, rule: null, label: null };
  }
  return {
    originalPrice: original,
    effectivePrice: winner.effective,
    savings: clampTwo(Math.max(0, original - winner.effective)),
    rule: winner.rule,
    label: buildLabel(winner.rule)
  };
}

// ── "When does it end?" — for the customer banner ────────────────────────

/**
 * Given a set of currently-active rules, return the soonest minute count
 * until any of them rolls out of its time window. Returns null when no rule
 * is active. Used by the customer-side banner ("Happy Hour ends at 18:00").
 */
export function minutesUntilHappyHourEnds(rules: HappyHourRuleLite[], now: Date = new Date()): { endsInMin: number; endsAt: string } | null {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  let best: number | null = null;
  for (const r of rules) {
    if (!isRuleInWindowNow(r, now)) continue;
    if (!r.schedules || r.schedules.length === 0) {
      // Always-on rule — its "end" is its validTo if set.
      if (r.validTo) {
        const dt = new Date(r.validTo);
        const deltaMin = Math.max(0, Math.round((dt.getTime() - now.getTime()) / 60000));
        if (best == null || deltaMin < best) best = deltaMin;
      }
      continue;
    }
    for (const s of r.schedules) {
      if (s.dayOfWeek === day && mins >= s.startMin && mins < s.endMin) {
        const delta = s.endMin - mins;
        if (best == null || delta < best) best = delta;
      }
    }
  }
  if (best == null) return null;
  const endHour = Math.floor((mins + best) / 60) % 24;
  const endMin = (mins + best) % 60;
  return {
    endsInMin: best,
    endsAt: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`
  };
}

// ── DB-aware loader ──────────────────────────────────────────────────────

/**
 * Load every rule that *could* matter for the current request — active +
 * in-validity-range — for a given restaurant. Time-of-day filtering happens
 * in-memory because (a) the candidate set is small (per-restaurant) and (b)
 * Postgres doesn't index multi-row JSON cheaply.
 */
export async function loadRulesForRestaurant(restaurantId: string, now: Date = new Date()): Promise<HappyHourRuleLite[]> {
  const rows = await (prisma as any).happyHourRule.findMany({
    where: {
      restaurantId,
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }]
    },
    include: { schedules: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    scope: r.scope,
    categoryId: r.categoryId ?? null,
    menuItemId: r.menuItemId ?? null,
    comboId: r.comboId ?? null,
    discountType: r.discountType,
    percentOff: r.percentOff ?? null,
    fixedPrice: r.fixedPrice ?? null,
    amountOff:  r.amountOff ?? null,
    minPrice:   r.minPrice ?? null,
    validFrom:  r.validFrom,
    validTo:    r.validTo,
    isActive:   r.isActive,
    priority:   r.priority,
    schedules:  (r.schedules ?? []).map((s: any) => ({ dayOfWeek: s.dayOfWeek, startMin: s.startMin, endMin: s.endMin }))
  }));
}

/**
 * Convenience for the order-creation hot path: given a list of menu items the
 * customer wants, return a Map<menuItemId, PricedItem>. Combos are returned
 * as a separate map keyed by comboId.
 */
export async function priceMenuItemsNow(
  restaurantId: string,
  items: ItemLite[],
  combos: ComboLite[] = [],
  now: Date = new Date()
): Promise<{ items: Map<string, PricedItem>; combos: Map<string, PricedItem> }> {
  const rules = await loadRulesForRestaurant(restaurantId, now);
  const itemMap = new Map<string, PricedItem>();
  for (const i of items) itemMap.set(i.id, priceForItem(i, rules, now));
  const comboMap = new Map<string, PricedItem>();
  for (const c of combos) comboMap.set(c.id, priceForCombo(c, rules, now));
  return { items: itemMap, combos: comboMap };
}
