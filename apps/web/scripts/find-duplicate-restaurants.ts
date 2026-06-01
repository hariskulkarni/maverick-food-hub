#!/usr/bin/env tsx
/**
 * find-duplicate-restaurants.ts
 *
 * One-shot diagnostic + cleanup helper for the "restaurant getting duplicated
 * whenever I change the logo" symptom. Reports any (name, ownerEmail) pair
 * that has more than one row, with the createdAt + order counts so you can
 * tell which copy to keep.
 *
 * USAGE (on the VPS):
 *
 *   cd /opt/restaurant-manager/apps/web
 *   npx tsx scripts/find-duplicate-restaurants.ts        # report only
 *   npx tsx scripts/find-duplicate-restaurants.ts --delete-empty
 *     # delete every duplicate that has ZERO orders AND ZERO branches AND
 *     # was created LATER than another duplicate with the same (name, owner).
 *     # Anything with real data is left alone — you delete those manually
 *     # from /platform/restaurants after a human review.
 *
 * NOTE: this file lives under apps/web/scripts/ (not the repo-root scripts/)
 * because tsx resolves @prisma/client from the nearest node_modules.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DupGroup {
  key: string;
  rows: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    createdAt: Date;
    ownerEmail: string;
    branchCount: number;
    orderCount: number;
  }>;
}

async function main() {
  const deleteEmpty = process.argv.includes('--delete-empty');

  const all = await prisma.restaurant.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      createdAt: true,
      owner: { select: { email: true } },
      _count: { select: { branches: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Order counts per restaurant (fetched separately to keep the query simple).
  const orderCounts = new Map<string, number>();
  for (const r of all) {
    const c = await prisma.order.count({ where: { branch: { restaurantId: r.id } } });
    orderCounts.set(r.id, c);
  }

  // Group by lowercase(name) + ownerEmail.
  const groups = new Map<string, DupGroup>();
  for (const r of all) {
    const ownerEmail = r.owner?.email?.toLowerCase() ?? '(no-owner)';
    const key = `${r.name.trim().toLowerCase()} :: ${ownerEmail}`;
    if (!groups.has(key)) groups.set(key, { key, rows: [] });
    groups.get(key)!.rows.push({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
      ownerEmail,
      branchCount: r._count.branches,
      orderCount: orderCounts.get(r.id) ?? 0,
    });
  }

  const dups = Array.from(groups.values()).filter((g) => g.rows.length > 1);

  if (dups.length === 0) {
    console.log('No duplicate restaurants found.');
    return;
  }

  console.log(`\nFound ${dups.length} duplicate group(s):\n`);
  for (const g of dups) {
    console.log(`Group: ${g.key}`);
    for (const r of g.rows) {
      console.log(
        `  - ${r.id}  slug=${r.slug.padEnd(28)}  status=${r.status.padEnd(8)}  ` +
          `created=${r.createdAt.toISOString().split('T')[0]}  ` +
          `branches=${r.branchCount}  orders=${r.orderCount}`,
      );
    }
    console.log();
  }

  if (!deleteEmpty) {
    console.log(
      'Re-run with --delete-empty to remove rows that have ZERO branches AND ZERO orders.\n' +
        'The OLDEST row in each group is always kept; only newer "empty" duplicates get deleted.',
    );
    return;
  }

  let deleted = 0;
  for (const g of dups) {
    // Sort oldest-first; the first one is the keeper.
    const sorted = [...g.rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const [keep, ...rest] = sorted;
    console.log(`Group ${g.key}: keeping ${keep.id} (${keep.slug})`);
    for (const r of rest) {
      if (r.branchCount === 0 && r.orderCount === 0) {
        console.log(`  -> deleting empty duplicate ${r.id} (${r.slug})`);
        // Cascade: delete dependent rows first.
        await prisma.$transaction(async (tx) => {
          await tx.restaurantUser.deleteMany({ where: { restaurantId: r.id } });
          await tx.restaurant.delete({ where: { id: r.id } });
        });
        deleted++;
      } else {
        console.log(
          `  -> SKIPPING ${r.id} (${r.slug}) - has ${r.branchCount} branch(es), ${r.orderCount} order(s). Delete via /platform/restaurants after manual review.`,
        );
      }
    }
  }

  console.log(`\nDone. Deleted ${deleted} empty duplicate row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
