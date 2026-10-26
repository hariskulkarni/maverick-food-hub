/**
 * Defect 7 — pausing orders flips Branch.isActive=false; staff surfaces must
 * still resolve the branch instead of showing the "no branch" notice.
 */
import { describe, it, expect, vi } from 'vitest';

type B = { id: string; restaurantId: string; isActive: boolean; createdAt: Date };
let branches: B[] = [];
function pick(args: any): B | null {
  const rows = branches.filter((b) =>
    b.restaurantId === args.where.restaurantId && (args.where.isActive === undefined || b.isActive === args.where.isActive)
  );
  const order: any[] = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
  rows.sort((a, b) => {
    for (const o of order) {
      const [k, dir] = Object.entries(o)[0] as [keyof B, string];
      const av = Number(a[k] instanceof Date ? (a[k] as Date).getTime() : a[k]);
      const bv = Number(b[k] instanceof Date ? (b[k] as Date).getTime() : b[k]);
      if (av !== bv) return dir === 'asc' ? av - bv : bv - av;
    }
    return 0;
  });
  return rows[0] ?? null;
}
vi.mock('@/server/db', () => ({
  prisma: {
    branch: {
      findFirst: async (a: any) => pick(a),
      findFirstOrThrow: async (a: any) => { const r = pick(a); if (!r) throw new Error('P2025'); return r; }
    }
  }
}));
vi.mock('@/server/tenancy', () => ({ requireRestaurant: async () => ({ id: 'r1' }) }));
vi.mock('@/server/group-scope', () => ({ resolveGroupContext: async () => ({ branchIds: [] }) }));

import { requireAdminBranch } from '@/server/reports/admin-branch';

describe('staff branch resolution while paused', () => {
  it('returns the only branch even when it is paused', async () => {
    branches = [{ id: 'b1', restaurantId: 'r1', isActive: false, createdAt: new Date('2026-01-01') }];
    expect((await requireAdminBranch()).branch.id).toBe('b1');
  });
  it('prefers an active branch over an older paused one', async () => {
    branches = [
      { id: 'old-paused', restaurantId: 'r1', isActive: false, createdAt: new Date('2025-01-01') },
      { id: 'new-active', restaurantId: 'r1', isActive: true, createdAt: new Date('2026-01-01') }
    ];
    expect((await requireAdminBranch()).branch.id).toBe('new-active');
  });
});
