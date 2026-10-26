/**
 * GET /api/admin/live/riders — the poll behind /admin/live. Before it existed
 * the restaurant view only followed the FIRST branch's SSE channel, so riders
 * working the group's other branches never appeared or moved. It must cover
 * every branch the admin manages and keep the page's access rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  restaurant: vi.fn(),
  branches: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('@/server/api-auth', () => ({ requireRestaurantAdminApi: h.gate }));
vi.mock('@/server/tenancy', () => ({ requireRestaurant: h.restaurant }));
vi.mock('@/server/live-fleet', () => ({ adminFleetBranches: h.branches, loadFleetSnapshot: h.snapshot }));

import { GET } from '@/app/api/admin/live/riders/route';

beforeEach(() => {
  h.gate.mockReset().mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
  h.restaurant.mockReset().mockResolvedValue({ id: 'rest-parent' });
  h.branches.mockReset().mockResolvedValue({
    isGroup: true,
    branches: [{ id: 'b-parent' }, { id: 'b-child-1' }, { id: 'b-child-2' }],
  });
  h.snapshot.mockReset().mockResolvedValue({ riders: [], customers: [], waiting: [] });
});

describe('GET /api/admin/live/riders', () => {
  it('returns the gate response for callers who are not a restaurant admin', async () => {
    h.gate.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(h.snapshot).not.toHaveBeenCalled();
  });

  it('returns 404 when the admin has no active restaurant', async () => {
    h.restaurant.mockRejectedValue(new Response('No restaurant for this user', { status: 404 }));
    const res = await GET();
    expect(res.status).toBe(404);
    expect(h.snapshot).not.toHaveBeenCalled();
  });

  it('snapshots EVERY branch of the restaurant / group, not just the first', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(h.branches).toHaveBeenCalledWith('rest-parent');
    expect(h.snapshot).toHaveBeenCalledWith({ branchIds: ['b-parent', 'b-child-1', 'b-child-2'] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ riders: [], customers: [], waiting: [] });
  });
});
