/**
 * getConfigInherited — credential inheritance down a restaurant group.
 *
 * The rule this locks in: a child outlet with no gateway of its own transacts
 * on its parent brand's merchant account, but a child that HAS its own always
 * wins. Getting this backwards would silently settle a franchisee's takings
 * into the parent's bank account, so each branch is pinned by a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  prisma: {
    restaurant: { findUnique: vi.fn() },
    integrationCredential: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));
const cache = vi.hoisted(() => ({
  // Bypass the cache wrapper entirely — we are testing the walk, not caching.
  wrap: vi.fn(async (_keys: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  invalidateTag: vi.fn(),
  keys: { integrationConfig: (r: string, p: string) => `${r}:${p}` },
}));
const crypto = vi.hoisted(() => ({
  decryptJSON: vi.fn((s: string) => JSON.parse(s)),
  encryptJSON: vi.fn((o: unknown) => JSON.stringify(o)),
}));

vi.mock('@/server/db', () => db);
vi.mock('@/server/cache', () => cache);
vi.mock('@/server/crypto', () => crypto);

import { getConfigInherited } from '@/server/integrations';

/** Wire a fake group: id → { parentId, config } */
function world(nodes: Record<string, { parentId?: string | null; config?: Record<string, string> }>) {
  db.prisma.restaurant.findUnique.mockImplementation(async ({ where }: any) => {
    const n = nodes[where.id];
    return n ? { parentId: n.parentId ?? null } : null;
  });
  db.prisma.integrationCredential.findUnique.mockImplementation(async ({ where }: any) => {
    const n = nodes[where.restaurantId_provider.restaurantId];
    if (!n?.config) return null;
    return { status: 'CONNECTED', configEncrypted: JSON.stringify(n.config) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.wrap.mockImplementation(async (_k: unknown, _o: unknown, fn: () => Promise<unknown>) => fn());
  crypto.decryptJSON.mockImplementation((s: string) => JSON.parse(s));
});

describe('getConfigInherited', () => {
  it('returns the restaurant’s own credentials and marks them not inherited', async () => {
    world({ child: { parentId: 'parent', config: { clientId: 'OWN' } }, parent: { config: { clientId: 'PARENT' } } });
    const got = await getConfigInherited('child', 'PHONEPE');
    expect(got).toEqual({ config: { clientId: 'OWN' }, ownerRestaurantId: 'child', inherited: false });
  });

  it('falls back to the parent when the child has none', async () => {
    world({ child: { parentId: 'parent' }, parent: { config: { clientId: 'PARENT' } } });
    const got = await getConfigInherited('child', 'PHONEPE');
    expect(got).toEqual({ config: { clientId: 'PARENT' }, ownerRestaurantId: 'parent', inherited: true });
  });

  it('walks more than one level up', async () => {
    world({ leaf: { parentId: 'mid' }, mid: { parentId: 'root' }, root: { config: { clientId: 'ROOT' } } });
    const got = await getConfigInherited('leaf', 'PHONEPE');
    expect(got?.ownerRestaurantId).toBe('root');
    expect(got?.inherited).toBe(true);
  });

  it('returns null when nobody in the chain is connected', async () => {
    world({ child: { parentId: 'parent' }, parent: {} });
    expect(await getConfigInherited('child', 'PHONEPE')).toBeNull();
  });

  it('returns null for a standalone restaurant with no credentials', async () => {
    world({ solo: {} });
    expect(await getConfigInherited('solo', 'PHONEPE')).toBeNull();
  });

  it('does not loop forever if the data contains a parent cycle', async () => {
    world({ a: { parentId: 'b' }, b: { parentId: 'a' } });
    expect(await getConfigInherited('a', 'PHONEPE')).toBeNull();
    // a → b → (a seen, stop). Two lookups, not an infinite walk.
    expect(db.prisma.restaurant.findUnique).toHaveBeenCalledTimes(2);
  });

  it('stops at the depth cap rather than walking an arbitrarily long chain', async () => {
    const nodes: Record<string, { parentId?: string | null; config?: Record<string, string> }> = {};
    for (let i = 0; i < 12; i++) nodes[`r${i}`] = { parentId: `r${i + 1}` };
    nodes.r11 = { config: { clientId: 'TOO_DEEP' } };
    world(nodes);
    expect(await getConfigInherited('r0', 'PHONEPE')).toBeNull();
    expect(db.prisma.restaurant.findUnique.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('ignores a row that exists but is not CONNECTED', async () => {
    db.prisma.restaurant.findUnique.mockResolvedValue({ parentId: null });
    db.prisma.integrationCredential.findUnique.mockResolvedValue({
      status: 'FAILED',
      configEncrypted: JSON.stringify({ clientId: 'BROKEN' }),
    });
    expect(await getConfigInherited('solo', 'PHONEPE')).toBeNull();
  });

  it('treats an undecryptable blob as absent and keeps walking', async () => {
    world({ child: { parentId: 'parent', config: { clientId: 'CORRUPT' } }, parent: { config: { clientId: 'PARENT' } } });
    crypto.decryptJSON.mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    const got = await getConfigInherited('child', 'PHONEPE');
    expect(got?.ownerRestaurantId).toBe('parent');
  });
});
