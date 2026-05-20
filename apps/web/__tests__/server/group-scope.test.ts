/**
 * Unit tests for the restaurant-group scope resolver. Pins down:
 *   - groupOrderChannel naming
 *   - groupRootIdFor: parent of a child, self for a top-level
 *   - resolveGroupContext: parent spans self + children, branch labels carry the
 *     right restaurant, isGroup reflects whether children exist
 *   - canManageInGroup: self + own children allowed, strangers rejected
 *
 * group-scope.ts touches prisma.restaurant, so we mock the prisma singleton
 * (same approach as freebies.test / menu-io.test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
vi.mock('@/server/db', () => ({
  prisma: { restaurant: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import {
  groupOrderChannel,
  groupRootIdFor,
  resolveGroupContext,
  canManageInGroup,
} from '@/server/group-scope';

beforeEach(() => findUnique.mockReset());

describe('groupOrderChannel', () => {
  it('namespaces by root id', () => {
    expect(groupOrderChannel('root1')).toBe('group:root1:orders');
  });
});

describe('groupRootIdFor', () => {
  it('returns the parent id for a child', async () => {
    findUnique.mockResolvedValue({ id: 'child1', parentId: 'parent1' });
    expect(await groupRootIdFor('child1')).toBe('parent1');
  });
  it('returns self for a top-level restaurant', async () => {
    findUnique.mockResolvedValue({ id: 'solo1', parentId: null });
    expect(await groupRootIdFor('solo1')).toBe('solo1');
  });
});

describe('resolveGroupContext', () => {
  it('spans parent + children and labels every branch with its restaurant', async () => {
    findUnique.mockResolvedValue({
      id: 'p', name: 'HQ Kitchen', slug: 'hq',
      branches: [{ id: 'pb1', name: 'HQ Main' }],
      children: [
        { id: 'c1', name: 'Downtown', slug: 'dt', branches: [{ id: 'c1b1', name: 'DT Branch' }] },
        { id: 'c2', name: 'Airport', slug: 'air', branches: [{ id: 'c2b1', name: 'Air Branch' }, { id: 'c2b2', name: 'Air T2' }] },
      ],
    });
    const ctx = await resolveGroupContext('p');
    expect(ctx.isGroup).toBe(true);
    expect(ctx.rootId).toBe('p');
    expect(ctx.restaurantIds.sort()).toEqual(['c1', 'c2', 'p']);
    expect(ctx.branchIds.sort()).toEqual(['c1b1', 'c2b1', 'c2b2', 'pb1']);
    expect(ctx.channel).toBe('group:p:orders');
    // Parent branch labelled as parent; child branch carries the child name.
    expect(ctx.labelByBranchId['pb1']).toMatchObject({ restaurantId: 'p', restaurantName: 'HQ Kitchen', isParent: true });
    expect(ctx.labelByBranchId['c2b2']).toMatchObject({ restaurantId: 'c2', restaurantName: 'Airport', isParent: false });
  });

  it('marks a childless restaurant as not-a-group (solo behaviour)', async () => {
    findUnique.mockResolvedValue({
      id: 'solo', name: 'Solo', slug: 'solo', branches: [{ id: 'sb1', name: 'Main' }], children: [],
    });
    const ctx = await resolveGroupContext('solo');
    expect(ctx.isGroup).toBe(false);
    expect(ctx.restaurantIds).toEqual(['solo']);
    expect(ctx.branchIds).toEqual(['sb1']);
  });

  it('degrades gracefully when the restaurant is missing', async () => {
    findUnique.mockResolvedValue(null);
    const ctx = await resolveGroupContext('ghost');
    expect(ctx.isGroup).toBe(false);
    expect(ctx.restaurantIds).toEqual(['ghost']);
    expect(ctx.channel).toBe('group:ghost:orders');
  });
});

describe('canManageInGroup', () => {
  it('allows acting on the active restaurant itself without a lookup', async () => {
    expect(await canManageInGroup('p', 'p')).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('allows the parent to manage its own child', async () => {
    findUnique.mockResolvedValue({ parentId: 'p' });
    expect(await canManageInGroup('p', 'c1')).toBe(true);
  });
  it('rejects a restaurant that is not a child of the active parent', async () => {
    findUnique.mockResolvedValue({ parentId: 'someoneElse' });
    expect(await canManageInGroup('p', 'stranger')).toBe(false);
  });
});
