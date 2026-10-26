import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory credential store standing in for the DB row.
const h = vi.hoisted(() => ({
  store: new Map<string, any>(),
  requireManagedRestaurant: vi.fn(),
  auth: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/server/tenancy', async () => ({ requireManagedRestaurant: h.requireManagedRestaurant, ...(await import('../../helpers/tenant-admin-mock')).tenantAdminMocks((rid) => (h.requireManagedRestaurant)(rid)) }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({
  prisma: { reviewAutoReplyConfig: { findUnique: vi.fn().mockResolvedValue(null) } },
}));
vi.mock('@/server/integrations', () => ({
  listForRestaurant: vi.fn(async (rid: string) =>
    ['GOOGLE_BUSINESS', 'LLM_REVIEWS'].map((provider) => {
      const row = h.store.get(`${rid}:${provider}`);
      return { provider, status: row?.status ?? 'DISCONNECTED', summary: row?.summary ?? null };
    })),
  // Real helper deletes the row (token + config gone).
  disconnect: vi.fn(async (rid: string, provider: string) => { h.store.delete(`${rid}:${provider}`); }),
}));

import { POST } from '@/app/api/admin/reviews/disconnect/route';
import { GET } from '@/app/api/admin/reviews/config/route';

const req = () => ({ nextUrl: new URL('http://x/api/admin/reviews/disconnect') }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.store.clear();
  h.store.set('rest1:GOOGLE_BUSINESS', {
    status: 'CONNECTED',
    config: { refreshToken: 'rt-secret', accountId: 'a1', locationId: 'l1', locations: '[]' },
    summary: { locationId: 'l1' },
  });
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.auth.mockResolvedValue({ user: { id: 'u1', role: 'RESTAURANT_ADMIN' } });
});

describe('POST /api/admin/reviews/disconnect', () => {
  it('returns 403 and changes nothing for a non-manager', async () => {
    h.requireManagedRestaurant.mockRejectedValue(new Response('Forbidden', { status: 403 }));
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(h.store.get('rest1:GOOGLE_BUSINESS').status).toBe('CONNECTED');
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('clears the stored token/config and audits', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.store.has('rest1:GOOGLE_BUSINESS')).toBe(false);
    expect(JSON.stringify([...h.store.values()])).not.toContain('rt-secret');
    expect(h.audit).toHaveBeenCalledWith('reviews.google.disconnect', expect.objectContaining({ restaurantId: 'rest1' }));
  });

  it('config GET reports DISCONNECTED afterwards', async () => {
    await POST(req());
    const res = await GET({ nextUrl: new URL('http://x/api/admin/reviews/config') } as any);
    const body = await res.json();
    expect(body.google).toEqual({ status: 'DISCONNECTED', summary: null });
  });
});
