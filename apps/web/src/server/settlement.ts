/**
 * Partner settlement engine.
 *
 * Computes the per-order settlement breakdown and the period roll-ups that
 * power the partner Settlement Report (Summary, Payout Breakup, Order Level,
 * Discounts Summary, Tax) — the in-app equivalent of the weekly xlsx partners
 * are used to.
 *
 * Money flow per delivered order:
 *   Net order value (A) = subtotal + packaging + delivery − promo disc − bonus disc + GST collected
 *   Commissionable value = subtotal − promo disc − bonus disc
 *   Commission          = commissionable × commission%        (per restaurant)
 *   Payment fee          = netOrderValue × paymentFee%         (online only)
 *   GST on fees          = (commission + payment fee) × 18%
 *   TCS (GST §52)        = netOrderValue × 1%
 *   TDS (IT §194O)       = gross order value × 1%
 *   Net deductions (C)   = commission + payment fee + GST on fees + TCS + TDS + other
 *   Net additions (D)    = recoveries / credits (0 in v1)
 *   Payout (E)           = A − C + D
 *
 * Tax rates are sensible Indian defaults and are configurable per restaurant /
 * globally; they are NOT tax advice. Confirm treatment with finance/CA.
 */
import { prisma } from './db';
import { OrderStatus } from '@prisma/client';

// ── Configurable rates (defaults; per-restaurant commission/paymentFee come from DB) ──
export const GST_ON_FEE_PCT = 18;
export const TCS_PCT = 1; // GST Section 52
export const TDS_PCT = 1; // Income Tax Section 194O

const DELIVERED = OrderStatus.DELIVERED;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null ? 0 : Number(v));

export interface SettlementConfig {
  commissionPct: number;
  paymentFeePct: number;
  gstOnFeePct?: number;
  tcsPct?: number;
  tdsPct?: number;
}

export interface OrderLike {
  id: string;
  code: string;
  placedAt: Date;
  status: OrderStatus;
  paymentMethod: string;
  fulfillmentType: string;
  discountConstruct: string;
  subtotal: number;
  packagingFee: number;
  deliveryFee: number;
  discountAmount: number;     // restaurant promo/coupon discount
  signupBonusApplied: number; // new-customer credit
  taxAmount: number;          // GST collected from customer
}

export interface SettlementLine {
  orderId: string;
  code: string;
  date: string;
  status: string;
  delivered: boolean;
  paymentMethod: string;
  fulfillmentType: string;
  discountConstruct: string;
  subtotal: number;
  packaging: number;
  delivery: number;
  discountPromo: number;
  discountBonus: number;
  gstCollected: number;
  netOrderValue: number;       // A
  commissionableValue: number;
  commissionPct: number;
  commission: number;
  paymentFee: number;
  feeSubtotal: number;
  gstOnFee: number;
  tcs: number;
  tds: number;
  govtCharges: number;
  netDeductions: number;       // C
  netAdditions: number;        // D
  payout: number;              // E
}

/** Pure: compute a settlement line from one order + config. */
export function computeSettlementLine(o: OrderLike, cfg: SettlementConfig): SettlementLine {
  const gstFeePct = cfg.gstOnFeePct ?? GST_ON_FEE_PCT;
  const tcsPct = cfg.tcsPct ?? TCS_PCT;
  const tdsPct = cfg.tdsPct ?? TDS_PCT;

  const subtotal = num(o.subtotal);
  const packaging = num(o.packagingFee);
  const delivery = num(o.deliveryFee);
  const promo = num(o.discountAmount);
  const bonus = num(o.signupBonusApplied);
  const gst = num(o.taxAmount);
  const delivered = o.status === DELIVERED;

  // Non-delivered (cancelled/failed) orders carry no settlement value in v1.
  if (!delivered) {
    return {
      orderId: o.id, code: o.code, date: o.placedAt.toISOString().slice(0, 10),
      status: o.status, delivered: false, paymentMethod: o.paymentMethod,
      fulfillmentType: o.fulfillmentType, discountConstruct: o.discountConstruct,
      subtotal, packaging, delivery, discountPromo: promo, discountBonus: bonus, gstCollected: gst,
      netOrderValue: 0, commissionableValue: 0, commissionPct: cfg.commissionPct, commission: 0,
      paymentFee: 0, feeSubtotal: 0, gstOnFee: 0, tcs: 0, tds: 0, govtCharges: 0,
      netDeductions: 0, netAdditions: 0, payout: 0,
    };
  }

  const netOrderValue = r2(subtotal + packaging + delivery - promo - bonus + gst);
  const commissionableValue = r2(Math.max(0, subtotal - promo - bonus));
  const commission = r2(commissionableValue * (cfg.commissionPct / 100));
  const isOnline = o.paymentMethod !== 'COD';
  const paymentFee = isOnline ? r2(netOrderValue * (cfg.paymentFeePct / 100)) : 0;
  const feeSubtotal = r2(commission + paymentFee);
  const gstOnFee = r2(feeSubtotal * (gstFeePct / 100));
  const tcs = r2(netOrderValue * (tcsPct / 100));
  const grossOrderValue = subtotal + packaging + delivery; // pre-discount, pre-GST gross
  const tds = r2(grossOrderValue * (tdsPct / 100));
  const govtCharges = r2(gstOnFee + tcs + tds);
  const netDeductions = r2(feeSubtotal + gstOnFee + tcs + tds);
  const netAdditions = 0;
  const payout = r2(netOrderValue - netDeductions + netAdditions);

  return {
    orderId: o.id, code: o.code, date: o.placedAt.toISOString().slice(0, 10),
    status: o.status, delivered: true, paymentMethod: o.paymentMethod,
    fulfillmentType: o.fulfillmentType, discountConstruct: o.discountConstruct,
    subtotal, packaging, delivery, discountPromo: promo, discountBonus: bonus, gstCollected: gst,
    netOrderValue, commissionableValue, commissionPct: cfg.commissionPct, commission,
    paymentFee, feeSubtotal, gstOnFee, tcs, tds, govtCharges,
    netDeductions, netAdditions, payout,
  };
}

export interface SettlementReport {
  restaurant: { id: string; name: string; legalName: string | null; gstin: string | null; pan: string | null; bankAccountLast4: string | null; settlementCycle: string; commissionPct: number; paymentFeePct: number };
  period: { from: string; to: string };
  summary: { deliveredOrders: number; cancelledOrders: number; totalOrders: number; netOrderValue: number; netDeductions: number; netAdditions: number; netPayout: number };
  payoutBreakup: { sno: string; particular: string; delivered: number; cancelled: number; total: number }[];
  lines: SettlementLine[];
  discountsSummary: { construct: string; orders: number; subtotal: number; discountGiven: number; discountPerOrder: number; effectivePct: number }[];
  tax: { component: string; basis: string; rate: string; total: number }[];
}

function constructOf(o: { offerRedemptions?: { offer?: unknown }[]; couponRedemption?: unknown; signupBonusApplied: unknown; discountAmount: unknown }): string {
  const off = o.offerRedemptions?.[0]?.offer as { name?: string; title?: string } | undefined;
  if (off) return off.name ?? off.title ?? 'Offer';
  if (o.couponRedemption) return 'Coupon';
  if (num(o.signupBonusApplied) > 0) return 'Signup bonus';
  if (num(o.discountAmount) > 0) return 'Promo';
  return 'None';
}

/** Build the full settlement report for a restaurant + date window. */
export async function buildSettlementReport(restaurantId: string, from: Date, to: Date): Promise<SettlementReport> {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: {
      id: true, name: true, legalName: true, gstin: true, pan: true,
      bankAccountLast4: true, settlementCycle: true, commissionPct: true, paymentFeePct: true,
      branches: { select: { id: true } },
    },
  });
  const branchIds = restaurant.branches.map((b) => b.id);
  const cfg: SettlementConfig = { commissionPct: restaurant.commissionPct, paymentFeePct: restaurant.paymentFeePct };

  const orders = await prisma.order.findMany({
    where: { branchId: { in: branchIds }, placedAt: { gte: from, lte: to } },
    orderBy: { placedAt: 'asc' },
    include: { offerRedemptions: { include: { offer: true } }, couponRedemption: true },
  });

  const lines = orders.map((o) =>
    computeSettlementLine(
      {
        id: o.id, code: o.code, placedAt: o.placedAt, status: o.status,
        paymentMethod: o.paymentMethod, fulfillmentType: o.fulfillmentType,
        discountConstruct: constructOf(o),
        subtotal: num(o.subtotal), packagingFee: num(o.packagingFee), deliveryFee: num(o.deliveryFee),
        discountAmount: num(o.discountAmount), signupBonusApplied: num(o.signupBonusApplied), taxAmount: num(o.taxAmount),
      },
      cfg,
    ),
  );

  const delivered = lines.filter((l) => l.delivered);
  const cancelled = lines.filter((l) => !l.delivered);
  const sum = (arr: SettlementLine[], k: keyof SettlementLine) => r2(arr.reduce((s, l) => s + (l[k] as number), 0));

  const summary = {
    deliveredOrders: delivered.length,
    cancelledOrders: cancelled.length,
    totalOrders: lines.length,
    netOrderValue: sum(delivered, 'netOrderValue'),
    netDeductions: sum(delivered, 'netDeductions'),
    netAdditions: sum(delivered, 'netAdditions'),
    netPayout: sum(delivered, 'payout'),
  };

  const row = (sno: string, particular: string, k: keyof SettlementLine) => ({
    sno, particular, delivered: sum(delivered, k), cancelled: sum(cancelled, k), total: sum(lines, k),
  });
  const payoutBreakup = [
    row('A', 'Net order value (A)', 'netOrderValue'),
    row('1', 'Subtotal (items total)', 'subtotal'),
    row('2', 'Packaging charge', 'packaging'),
    row('3', 'Delivery charge from customer', 'delivery'),
    row('4', 'Restaurant discount (Promo)', 'discountPromo'),
    row('5', 'Signup-bonus discount', 'discountBonus'),
    row('6', 'GST collected from customer', 'gstCollected'),
    row('B', 'Commission / service fee', 'commission'),
    row('7', 'Payment mechanism fee', 'paymentFee'),
    row('8', 'GST on fees (18%)', 'gstOnFee'),
    row('9', 'TCS (1%)', 'tcs'),
    row('10', 'TDS 194O (1%)', 'tds'),
    row('C', 'Net deductions (C)', 'netDeductions'),
    row('D', 'Net additions (D)', 'netAdditions'),
    row('E', 'Net payout (A − C + D)', 'payout'),
  ];

  // Discounts summary grouped by construct (delivered orders).
  const byConstruct = new Map<string, { orders: number; subtotal: number; discount: number }>();
  for (const l of delivered) {
    const g = byConstruct.get(l.discountConstruct) ?? { orders: 0, subtotal: 0, discount: 0 };
    g.orders += 1; g.subtotal += l.subtotal; g.discount += l.discountPromo + l.discountBonus;
    byConstruct.set(l.discountConstruct, g);
  }
  const discountsSummary = [...byConstruct.entries()].map(([construct, g]) => ({
    construct, orders: g.orders, subtotal: r2(g.subtotal), discountGiven: r2(g.discount),
    discountPerOrder: g.orders ? r2(g.discount / g.orders) : 0,
    effectivePct: g.subtotal ? r2((g.discount / g.subtotal) * 100) : 0,
  })).sort((a, b) => b.discountGiven - a.discountGiven);

  const tax = [
    { component: 'GST collected from customer', basis: 'On food (customer)', rate: 'as charged', total: sum(delivered, 'gstCollected') },
    { component: 'Commission / service fee', basis: 'Commissionable value', rate: `${cfg.commissionPct}%`, total: sum(delivered, 'commission') },
    { component: 'Payment mechanism fee', basis: 'Net order value (online)', rate: `${cfg.paymentFeePct}%`, total: sum(delivered, 'paymentFee') },
    { component: 'GST on platform fees', basis: 'Commission + payment fee', rate: `${GST_ON_FEE_PCT}%`, total: sum(delivered, 'gstOnFee') },
    { component: 'TCS under GST (Sec 52)', basis: 'Net order value', rate: `${TCS_PCT}%`, total: sum(delivered, 'tcs') },
    { component: 'TDS under IT (Sec 194O)', basis: 'Gross order value', rate: `${TDS_PCT}%`, total: sum(delivered, 'tds') },
    { component: 'Total government charges', basis: 'TCS + TDS + GST on fees', rate: '—', total: sum(delivered, 'govtCharges') },
  ];

  return {
    restaurant: {
      id: restaurant.id, name: restaurant.name, legalName: restaurant.legalName,
      gstin: restaurant.gstin, pan: restaurant.pan, bankAccountLast4: restaurant.bankAccountLast4,
      settlementCycle: restaurant.settlementCycle, commissionPct: restaurant.commissionPct, paymentFeePct: restaurant.paymentFeePct,
    },
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    summary, payoutBreakup, lines, discountsSummary, tax,
  };
}
