/**
 * One-off operational script: turn ON the three order-flow features for all
 * ACTIVE restaurants — self-pickup, scheduled ordering, and dine-in / table
 * reservations — and print a before/after report.
 *
 * Safe + idempotent: it only flips a toggle from OFF → ON, never the reverse, so
 * re-running it does nothing once everything is enabled.
 *
 * Note on dine-in: enabling the toggle makes the Dine-in option appear at
 * checkout and unlocks the admin Tables + Reservations pages. Each restaurant
 * still needs to add its table inventory (Admin → Tables) before customers can
 * actually book — this script just switches the capability on.
 *
 * Run from apps/web on the machine that can reach the database:
 *   npx tsx prisma/enable-order-flow.ts            # enable everywhere
 *   npx tsx prisma/enable-order-flow.ts --dry-run  # report only, change nothing
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const onoff = (b: boolean) => (b ? 'ON ' : 'off');

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, name: true, slug: true,
      selfPickupEnabled: true, scheduledOrdersEnabled: true, dineInEnabled: true,
    },
    orderBy: { name: 'asc' },
  });

  if (restaurants.length === 0) {
    console.log('No ACTIVE restaurants found.');
    return;
  }

  console.log(`\nFound ${restaurants.length} active restaurant(s). Current state:\n`);
  for (const r of restaurants) {
    console.log(
      `  ${r.name.padEnd(28)}  pickup=${onoff(r.selfPickupEnabled)}  scheduled=${onoff(r.scheduledOrdersEnabled)}  dine-in=${onoff(r.dineInEnabled)}`
    );
  }

  const needsUpdate = restaurants.filter(
    (r) => !r.selfPickupEnabled || !r.scheduledOrdersEnabled || !r.dineInEnabled
  );
  if (needsUpdate.length === 0) {
    console.log('\n✓ Every active restaurant already has self-pickup, scheduled ordering AND dine-in ON. Nothing to do.\n');
    return;
  }

  console.log(`\n${needsUpdate.length} restaurant(s) need at least one toggle turned on.`);
  if (DRY_RUN) {
    console.log('--dry-run set: no changes written.\n');
    return;
  }

  const res = await prisma.restaurant.updateMany({
    where: {
      status: 'ACTIVE',
      OR: [{ selfPickupEnabled: false }, { scheduledOrdersEnabled: false }, { dineInEnabled: false }],
    },
    data: { selfPickupEnabled: true, scheduledOrdersEnabled: true, dineInEnabled: true },
  });
  console.log(`\n✓ Updated ${res.count} restaurant(s). Self-pickup + scheduled ordering + dine-in are now ON.`);
  console.log('  Reminder: add table inventory under Admin → Tables so customers can actually reserve.\n');
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
