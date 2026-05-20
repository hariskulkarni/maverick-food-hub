/**
 * Guard rails for super-admin parent (group) assignment.
 *
 * The hierarchy is intentionally SINGLE-LEVEL: parent → children, never deeper.
 * resolveGroupContext relies on that (it only queries one level of children), so
 * these checks keep the tree flat:
 *   - a restaurant can't be its own parent;
 *   - the chosen parent must itself be top-level (parentId === null) — assigning
 *     a parent that already has a parent would create a 3-level chain;
 *   - a restaurant that already has children can't become a child (it's a parent
 *     already, so nesting it would create grandchildren).
 * Clearing (parentId === null) is always allowed.
 */
import { prisma } from '@/server/db';

export interface AssignResult {
  ok: boolean;
  /** Human-readable reason when ok === false. */
  error?: string;
  status?: number;
}

export async function validateParentAssignment(restaurantId: string, parentId: string | null): Promise<AssignResult> {
  const subject = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, parentId: true, _count: { select: { children: true } } },
  });
  if (!subject) return { ok: false, error: 'Restaurant not found', status: 404 };

  // Detach is always safe.
  if (parentId === null) return { ok: true };

  if (parentId === restaurantId) {
    return { ok: false, error: 'A restaurant cannot be its own parent.', status: 400 };
  }

  // The subject must not already be a parent (no nesting a group under another).
  if (subject._count.children > 0) {
    return { ok: false, error: 'This restaurant already has children; detach them before making it a child.', status: 400 };
  }

  const parent = await prisma.restaurant.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true },
  });
  if (!parent) return { ok: false, error: 'Parent restaurant not found', status: 404 };

  // The chosen parent must itself be top-level — prevents a 3rd level.
  if (parent.parentId !== null) {
    return { ok: false, error: 'Chosen parent is itself a child; only top-level restaurants can be parents.', status: 400 };
  }

  return { ok: true };
}
