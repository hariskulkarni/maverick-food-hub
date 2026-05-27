/**
 * Re-parent the restaurant group so **Bowl and Barbeque** is the umbrella
 * (top-level) restaurant and every other outlet becomes its child.
 *
 * Also carries the previous umbrella's (Combo Nation) group-sharing flags and
 * its access over to the new umbrella, so the restaurant-admin and kitchen
 * logins keep all-outlet access + the outlet switcher. Access flows from the
 * parent via accessibleSet(): a user who OWNS or is ADMIN of the umbrella reaches
 * every child; a KITCHEN grant on the umbrella reaches every child kitchen.
 *
 * Safe + idempotent — re-running makes no further changes.
 *
 *   Run on the VPS:  cd /opt/restaurant-manager/apps/web && npm run db:reparent
 *   (or)             npx tsx prisma/reparent-group.ts
 *   Preview only:    npx tsx prisma/reparent-group.ts --dry-run
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const NEW_PARENT = { slug: 'bowl-and-barbeque', name: 'Bowl and Barbeque' };
// The previous umbrella, whose access + sharing we carry forward.
const OLD_PARENT = { slug: 'saffron-smoke', name: 'Combo Nation' };

async function main() {
  const newParent = await prisma.restaurant.findFirst({
    where: { OR: [{ slug: NEW_PARENT.slug }, { name: NEW_PARENT.name }] },
    select: { id: true, name: true, slug: true, parentId: true },
  });
  if (!newParent) throw new Error(`New parent "${NEW_PARENT.name}" not found`);

  const oldParent = await prisma.restaurant.findFirst({
    where: { OR: [{ slug: OLD_PARENT.slug }, { name: OLD_PARENT.name }] },
    select: {
      id: true, name: true, slug: true, ownerUserId: true,
      groupShareMenu: true, groupShareRiders: true, groupShareReports: true,
    },
  });

  const all = await prisma.restaurant.findMany({ select: { id: true, name: true, slug: true, parentId: true } });
  const children = all.filter((r) => r.id !== newParent.id);

  console.log(`\nUmbrella → ${newParent.name} (${newParent.slug})`);
  console.log(`Children (${children.length}): ${children.map((c) => c.name).join(', ')}`);
  if (oldParent && oldParent.id !== newParent.id) {
    console.log(`Carrying access + group-sharing from old umbrella: ${oldParent.name}`);
  }
  if (DRY_RUN) { console.log('\n--dry-run: no changes written.\n'); return; }

  // 1) Re-parent: Bowl and Barbeque → root; every other outlet → its child.
  await prisma.$transaction([
    prisma.restaurant.update({ where: { id: newParent.id }, data: { parentId: null } }),
    ...children.map((r) => prisma.restaurant.update({ where: { id: r.id }, data: { parentId: newParent.id } })),
  ]);

  // 2) Carry access + group-sharing from the old umbrella to the new one.
  if (oldParent && oldParent.id !== newParent.id) {
    await prisma.restaurant.update({
      where: { id: newParent.id },
      data: {
        groupShareMenu: oldParent.groupShareMenu,
        groupShareRiders: oldParent.groupShareRiders,
        groupShareReports: oldParent.groupShareReports,
      },
    });

    // The old umbrella's OWNER (the restaurant admin) gets ADMIN on the new
    // umbrella so the ADMIN cascade reaches every outlet — regardless of whether
    // their original access was ownership- or grant-based. We do NOT change the
    // new parent's ownerUserId (avoids disturbing its existing ownership).
    if (oldParent.ownerUserId) {
      await prisma.restaurantUser.upsert({
        where: { restaurantId_userId: { restaurantId: newParent.id, userId: oldParent.ownerUserId } },
        update: { role: Role.ADMIN },
        create: { restaurantId: newParent.id, userId: oldParent.ownerUserId, role: Role.ADMIN },
      });
    }

    // Copy every ADMIN + KITCHEN grant from the old umbrella → new umbrella, so
    // the kitchen login (and any extra admins) keep all-outlet access.
    const grants = await prisma.restaurantUser.findMany({ where: { restaurantId: oldParent.id } });
    for (const g of grants) {
      await prisma.restaurantUser.upsert({
        where: { restaurantId_userId: { restaurantId: newParent.id, userId: g.userId } },
        update: { role: g.role },
        create: { restaurantId: newParent.id, userId: g.userId, role: g.role },
      });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const after = await prisma.restaurant.findMany({
    select: { name: true, slug: true, parentId: true },
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
  });
  console.log('');
  for (const r of after) {
    console.log(`  ${r.parentId === null ? '▸ ROOT ' : '   child'}  ${r.name} (${r.slug})`);
  }
  const grantsAfter = await prisma.restaurantUser.findMany({
    where: { restaurantId: newParent.id },
    include: { user: { select: { email: true, name: true } } },
  });
  console.log(
    `\nAccess on ${newParent.name}: ` +
      (grantsAfter.map((g) => `${g.user.email ?? g.user.name}:${g.role}`).join(', ') || '(none)'),
  );
  console.log('\nDone. Admin + Kitchen logins now reach every outlet via the new umbrella.\n');
}

main()
  .catch((e) => { console.error('Failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
