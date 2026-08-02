import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

/**
 * Flat restaurant list for super-admin pickers: every restaurant, ordered so a
 * parent is immediately followed by its children. Unlike /groups it also
 * returns solo restaurants, because the payment-gateway panel must be able to
 * target any tenant — not only those already in a group.
 */
export async function GET(_req: NextRequest) {
  await requireSuperAdmin();

  const all = await prisma.restaurant.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, status: true, parentId: true },
  });

  const byParent = new Map<string, typeof all>();
  for (const r of all) {
    if (!r.parentId) continue;
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }

  const ordered: Array<(typeof all)[number] & { depth: number }> = [];
  for (const r of all) {
    if (r.parentId) continue;
    ordered.push({ ...r, depth: 0 });
    for (const child of byParent.get(r.id) ?? []) ordered.push({ ...child, depth: 1 });
  }
  // Orphans: a child whose parent is archived/missing would otherwise vanish.
  for (const r of all) {
    if (r.parentId && !ordered.some((o) => o.id === r.id)) ordered.push({ ...r, depth: 0 });
  }

  return Response.json({ restaurants: ordered });
}
