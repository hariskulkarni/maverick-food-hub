/**
 * One-off operational script: turn ON self-pickup + scheduled ordering for all
 * ACTIVE restaurants, and print a before/after report.
 *
 * Safe + idempotent: it only flips a toggle from OFF → ON, never the reverse, so
 * re-running it does nothing once everything is enabled. Dine-in is intentionally
 * left untouched (it pulls in the whole reservation/table suite and should be
 * opted into per restaurant).
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

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, selfPickupEnabled: true, scheduledOrdersEnabled: true },
    orderBy: { name: 'asc' },
  });

  if (restaurants.length === 0) {
    console.log('No ACTIVE restaurants found.');
    return;
  }

  console.log(`\nFound ${restaurants.length} active restaurant(s). Current state:\n`);
  for (const r of restaurants) {
    console.log(
      `  ${r.name.padEnd(28)}  pickup=${r.selfPickupEnabled ? 'ON ' : 'off'}  scheduled=${r.scheduledOrdersEnabled ? 'ON ' : 'off'}`
    );
  }

  const needsUpdate = restaurants.filter((r) => !r.selfPickupEnabled || !r.scheduledOrdersEnabled);
  if (needsUpdate.length === 0) {
    console.log('\n✓ Every active restaurant already has self-pickup AND scheduled ordering ON. Nothing to do.\n');
    return;
  }

  console.log(`\n${needsUpdate.length} restaurant(s) need at least one toggle turned on.`);
  if (DRY_RUN) {
    console.log('--dry-run set: no changes written.\n');
    return;
  }

  const res = await prisma.restaurant.updateMany({
    where: { status: 'ACTIVE', OR: [{ selfPickupEnabled: false }, { scheduledOrdersEnabled: false }] },
    data: { selfPickupEnabled: true, scheduledOrdersEnabled: true },
  });
  console.log(`\n✓ Updated ${res.count} restaurant(s). Self-pickup + scheduled ordering are now ON.\n`);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
