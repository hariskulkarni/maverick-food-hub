/**
 * Cancel stale, stuck orders left in a non-terminal state (old demo/seed data or
 * abandoned orders) so they stop firing "stuck order" alerts and cluttering
 * dispatch. Cancels via the normal CANCELLED_BY_ADMIN transition, which frees
 * the rider's assignment and restores customer benefits.
 *
 * Dry-run by default — prints what it WOULD cancel. Pass --apply to execute.
 *
 *   npx tsx scripts/cleanup-stale-orders.ts                 # dry-run, >7 days
 *   npx tsx scripts/cleanup-stale-orders.ts --days 7
 *   npx tsx scripts/cleanup-stale-orders.ts --apply --days 7 --limit 1000
 *
 * Safety:
 *  - Only orders OLDER than --days (default 7) are touched. Recent stuck orders
 *    (a genuine problem to resolve in ops) are never auto-cancelled.
 *  - Only non-terminal statuses are considered; delivered/cancelled/refunded/
 *    failed orders are skipped.
 *  - Orders with a CAPTURED online payment are SKIPPED unless --include-paid
 *    (so we never cancel something that took real money without a refund).
 *  - A per-run cap (--limit, default 1000).
 */
import { prisma } from '../src/server/db';
import { transitionOrder } from '../src/server/orders';
import { OrderStatus, PaymentStatus } from '@prisma/client';

const TERMINAL: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUND_INITIATED,
  OrderStatus.REFUNDED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.PAYMENT_FAILED,
];

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

async function main(): Promise<number> {
  const days = opt('days', 7);
  const limit = opt('limit', 1000);
  const apply = flag('apply');
  const includePaid = flag('include-paid');
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const stale = await prisma.order.findMany({
    where: { status: { notIn: TERMINAL }, placedAt: { lt: cutoff } },
    select: { id: true, code: true, status: true, placedAt: true,
              payments: { where: { status: PaymentStatus.CAPTURED }, select: { id: true } } },
    orderBy: { placedAt: 'asc' },
    take: limit,
  });

  const byStatus = new Map<string, number>();
  for (const o of stale) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  console.log(`Found ${stale.length} stale order(s) older than ${days} day(s) in a non-terminal state:`);
  for (const [s, n] of [...byStatus.entries()].sort()) console.log(`  ${s.padEnd(24)} ${n}`);
  if (stale.length) {
    const oldest = stale[0], newest = stale[stale.length - 1];
    console.log(`  oldest ${oldest.code} (${oldest.placedAt.toISOString().slice(0, 10)}), newest ${newest.code} (${newest.placedAt.toISOString().slice(0, 10)})`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply to cancel these.');
    return 0;
  }

  let cancelled = 0, skippedPaid = 0, failed = 0;
  for (const o of stale) {
    if (o.payments.length && !includePaid) { skippedPaid++; continue; }
    try {
      await transitionOrder(o.id, OrderStatus.CANCELLED_BY_ADMIN, { note: `Stale-order cleanup (>${days}d, system)` });
      cancelled++;
    } catch (e) {
      failed++;
      console.warn(`  skip ${o.code} (${o.status}): ${(e as Error).message}`);
    }
  }
  console.log(`\nCancelled ${cancelled}. Skipped (captured payment) ${skippedPaid}. Could not transition ${failed}.`);
  return 0;
}

main()
  .then(async (c) => { await prisma.$disconnect(); process.exit(c); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
