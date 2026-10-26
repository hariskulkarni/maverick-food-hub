/**
 * Payment-mode labels for exports and reports. A Flavrly PG order rides an online PaymentMethod
 * (RAZORPAY/PHONEPE) internally, but the money went by direct UPI into the restaurant's bank account,
 * so reports must not show it as a Razorpay/PhonePe payment (round-2 P2).
 */
import { Prisma } from '@prisma/client';
import { prisma } from './db';

export const PG_PAYMENT_MODE = 'FLAVRLY_PG_DIRECT_UPI';
export const PG_PAYMENT_MODE_LABEL = 'Flavrly PG (direct UPI)';

export function paymentModeOf(o: { paymentMethod: string; payments?: { providerName: string | null }[] }): string {
  return o.payments?.some((p) => p.providerName === 'youpi') ? PG_PAYMENT_MODE : o.paymentMethod;
}

type ModeRow = { paymentMethod: string; _sum: { total: Prisma.Decimal | null }; _count: { _all: number } };

/** Moves Flavrly PG orders out of their RAZORPAY/PHONEPE bucket into their own row. Exact decimals. */
export async function splitPgPaymentModes(rows: ModeRow[], where: Prisma.OrderWhereInput): Promise<{ mode: string; count: number; amount: Prisma.Decimal }[]> {
  const pg = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: { AND: [where, { payments: { some: { providerName: 'youpi' } } }] },
  });
  const zero = new Prisma.Decimal(0);
  const out = new Map(rows.map((r) => [r.paymentMethod, { mode: r.paymentMethod, count: r._count._all, amount: r._sum.total ?? zero }]));
  const pgRow = { mode: PG_PAYMENT_MODE, count: 0, amount: zero };
  for (const p of pg) {
    const amt = p._sum.total ?? zero;
    const b = out.get(p.paymentMethod);
    if (b) {
      b.count -= p._count._all;
      b.amount = b.amount.sub(amt);
    }
    pgRow.count += p._count._all;
    pgRow.amount = pgRow.amount.add(amt);
  }
  const list = [...out.values()].filter((b) => b.count > 0);
  if (pgRow.count > 0) list.push(pgRow);
  return list.sort((a, b) => b.amount.comparedTo(a.amount));
}
