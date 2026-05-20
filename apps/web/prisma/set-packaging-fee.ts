/**
 * One-off operational script: set the restaurant packaging fee on every Branch.
 *
 * The schema column defaults to ₹20, so on a fresh `prisma migrate deploy` /
 * `db push` existing rows already get ₹20 automatically. This script is the
 * explicit, auditable way to (a) confirm the value everywhere and (b) set a
 * different flat amount across the board if you want something other than ₹20.
 *
 * Safe + idempotent: by default it only fills branches whose packagingFee is 0
 * (i.e. never been set), leaving any branch a restaurant has already customised
 * untouched. Pass --force to overwrite every branch to the target amount.
 *
 * Run from apps/web on the machine that can reach the database:
 *   npx tsx prisma/set-packaging-fee.ts                 # fill 0-fee branches with ₹20
 *   npx tsx prisma/set-packaging-fee.ts --amount 25     # use ₹25 instead of ₹20
 *   npx tsx prisma/set-packaging-fee.ts --force         # overwrite ALL branches to the amount
 *   npx tsx prisma/set-packaging-fee.ts --dry-run       # report only, change nothing
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function parseAmount(): number {
  const i = process.argv.indexOf('--amount');
  if (i === -1) return 20;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) {
    console.error(`Invalid --amount "${process.argv[i + 1]}"; must be a number ≥ 0.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const amount = parseAmount();
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true, packagingFee: true, restaurant: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  if (branches.length === 0) {
    console.log('No branches found.');
    return;
  }

  console.log(
    `Target packaging fee: ₹${amount}  |  mode: ${FORCE ? 'FORCE (overwrite all)' : 'fill only 0-fee branches'}` +
    (DRY_RUN ? '  |  DRY RUN' : '')
  );
  console.log('─'.repeat(70));

  let changed = 0;
  for (const b of branches) {
    const current = Number(b.packagingFee);
    const shouldUpdate = FORCE ? current !== amount : current === 0;
    const label = `${b.restaurant?.name ?? '—'} · ${b.name}`;
    if (!shouldUpdate) {
      console.log(`  skip  ₹${current.toFixed(2).padStart(7)}  ${label}`);
      continue;
    }
    console.log(`  set   ₹${current.toFixed(2)} → ₹${amount.toFixed(2)}  ${label}`);
    if (!DRY_RUN) {
      await prisma.branch.update({
        where: { id: b.id },
        data: { packagingFee: new Prisma.Decimal(amount) },
      });
    }
    changed++;
  }

  console.log('─'.repeat(70));
  console.log(
    DRY_RUN
      ? `Would update ${changed} of ${branches.length} branch(es). Re-run without --dry-run to apply.`
      : `Updated ${changed} of ${branches.length} branch(es).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
