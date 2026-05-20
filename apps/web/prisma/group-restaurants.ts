/**
 * Group restaurants into a parent → child hierarchy, so the parent owner sees a
 * combined dashboard (orders, riders, reports) spanning the parent + children.
 *
 * Usage (run where the DB is reachable, e.g. on the VPS from apps/web):
 *   npx tsx prisma/group-restaurants.ts <parentSlug> [childSlug ...]
 *
 *   - With child slugs: links exactly those restaurants under the parent.
 *   - Without child slugs: links ALL other ACTIVE top-level restaurants under it.
 *   - Add --dry-run to preview without writing.
 *
 * Example:
 *   npx tsx prisma/group-restaurants.ts combo-nation            # everything under Combo Nation
 *   npx tsx prisma/group-restaurants.ts combo-nation spice-route biryani-house
 *
 * Safe + idempotent: skips the parent itself, skips restaurants that are already
 * parents (have children — single-level hierarchy), and never changes ownership.
 * To see slugs first:  npx tsx prisma/group-restaurants.ts --list
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST = args.includes('--list');
const positional = args.filter((a) => !a.startsWith('--'));

async function listAll() {
  const all = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { slug: true, name: true, parentId: true, _count: { select: { children: true } } },
    orderBy: { name: 'asc' },
  });
  console.log('\nActive restaurants (slug — name — role):');
  for (const r of all) {
    const role = r._count.children > 0 ? 'PARENT' : r.parentId ? 'child' : 'standalone';
    console.log(`  ${r.slug.padEnd(24)} ${r.name.padEnd(28)} ${role}`);
  }
  console.log('');
}

async function main() {
  if (LIST || positional.length === 0) {
    await listAll();
    if (positional.length === 0) {
      console.log('Provide a parent slug:  npx tsx prisma/group-restaurants.ts <parentSlug> [childSlug ...]\n');
    }
    return;
  }

  const [parentSlug, ...childSlugs] = positional;
  const parent = await prisma.restaurant.findUnique({
    where: { slug: parentSlug },
    select: { id: true, name: true, parentId: true },
  });
  if (!parent) { console.error(`Parent restaurant "${parentSlug}" not found.`); process.exit(1); }
  if (parent.parentId) { console.error(`"${parentSlug}" is itself a child — pick a top-level restaurant as the parent.`); process.exit(1); }

  // Resolve the candidate children.
  const candidates = await prisma.restaurant.findMany({
    where: childSlugs.length
      ? { slug: { in: childSlugs } }
      : { status: 'ACTIVE', parentId: null, id: { not: parent.id } },
    select: { id: true, slug: true, name: true, parentId: true, _count: { select: { children: true } } },
    orderBy: { name: 'asc' },
  });

  const toLink: { id: string; name: string }[] = [];
  for (const c of candidates) {
    if (c.id === parent.id) continue;                              // not itself
    if (c._count.children > 0) { console.log(`  skip ${c.slug} (it's a parent of others)`); continue; }
    if (c.parentId === parent.id) { console.log(`  ok   ${c.slug} (already under ${parent.name})`); continue; }
    toLink.push({ id: c.id, name: c.name });
  }

  console.log(`\nParent: ${parent.name} (${parentSlug})`);
  console.log(`Will link ${toLink.length} restaurant(s) as children: ${toLink.map((c) => c.name).join(', ') || '(none)'}`);
  if (DRY_RUN) { console.log('\n--dry-run: no changes written.\n'); return; }
  if (toLink.length === 0) { console.log('\nNothing to do.\n'); return; }

  await prisma.restaurant.updateMany({
    where: { id: { in: toLink.map((c) => c.id) } },
    data: { parentId: parent.id },
  });
  console.log(`\n✓ Linked ${toLink.length} restaurant(s) under ${parent.name}.`);
  console.log(`Now log in as ${parent.name}'s owner to see the combined parent + child dashboard.\n`);
}

main()
  .catch((e) => { console.error('Failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
