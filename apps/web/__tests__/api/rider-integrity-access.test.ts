/**
 * Rider location-integrity review queue access control. Viewing the queue
 * needs riders:read; acting (review action) and changing the anti-fraud policy
 * need riders:write. Everything else is 403 (anonymous 401), and nothing is
 * read or mutated when the gate rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  session: null as any,
  list: vi.fn(async () => []),
  getConfig: vi.fn(async () => ({ mockPingThreshold: 3, autoPauseOffers: false, gateOnlineOnFailed: false })),
  updateConfig: vi.fn(async () => ({ mockPingThreshold: 5, autoPauseOffers: true, gateOnlineOnFailed: false })),
  review: vi.fn(async () => ({ status: 'CLEARED', locationSuspect: false, offersPaused: false })),
  audit: vi.fn(async () => {}),
}));

vi.mock('@/server/auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/audit', () => ({ audit: m.audit }));
vi.mock('@/server/rider-integrity/service', () => ({
  listIntegrityQueue: m.list,
  reviewRider: m.review,
}));
vi.mock('@/server/rider-integrity/config', () => ({
  getIntegrityConfig: m.getConfig,
  updateIntegrityConfig: m.updateConfig,
}));

import { GET, POST, PUT } from '@/app/api/platform/rider-integrity/route';

const as = (role: string | null) => (m.session = role ? { user: { id: `u-${role}`, role } } : null);
const getReq = () => new NextRequest('http://x/api/platform/rider-integrity');
const postReq = (body: any) =>
  new NextRequest('http://x/api/platform/rider-integrity', { method: 'POST', body: JSON.stringify(body) });
const putReq = (body: any) =>
  new NextRequest('http://x/api/platform/rider-integrity', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  m.list.mockClear();
  m.review.mockClear();
  m.updateConfig.mockClear();
  m.audit.mockClear();
});

describe('GET queue — riders:read', () => {
  it.each(['SUPER_ADMIN', 'ADMIN_ASSIST', 'QA', 'GUEST'])('%s → 200', async (role) => {
    as(role);
    expect((await GET(getReq())).status).toBe(200);
  });
  it.each(['KITCHEN', 'ADMIN', 'RIDER', 'CUSTOMER'])('%s → 403, nothing read', async (role) => {
    as(role);
    expect((await GET(getReq())).status).toBe(403);
    expect(m.list).not.toHaveBeenCalled();
  });
  it('anonymous → 401', async () => {
    as(null);
    expect((await GET(getReq())).status).toBe(401);
  });
});

describe('POST review action — riders:write', () => {
  it.each(['SUPER_ADMIN', 'ADMIN_ASSIST'])('%s → 200 and audited', async (role) => {
    as(role);
    const res = await POST(postReq({ riderId: 'r1', action: 'clear' }));
    expect(res.status).toBe(200);
    expect(m.review).toHaveBeenCalledWith('r1', 'clear', `u-${role}`, null);
    expect(m.audit).toHaveBeenCalledWith('rider.integrity.review', expect.objectContaining({ entityId: 'r1' }));
  });
  it.each(['QA', 'GUEST', 'RIDER'])('%s (no riders:write) → 403, no action', async (role) => {
    as(role);
    expect((await POST(postReq({ riderId: 'r1', action: 'clear' }))).status).toBe(403);
    expect(m.review).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('rejects an invalid action with 400', async () => {
    as('SUPER_ADMIN');
    expect((await POST(postReq({ riderId: 'r1', action: 'nuke' }))).status).toBe(400);
  });
});

describe('PUT policy — riders:write', () => {
  it('SUPER_ADMIN updates and audits', async () => {
    as('SUPER_ADMIN');
    const res = await PUT(putReq({ mockPingThreshold: 5, autoPauseOffers: true }));
    expect(res.status).toBe(200);
    expect(m.updateConfig).toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith('rider.integrity.config.update', expect.any(Object));
  });
  it.each(['QA', 'GUEST'])('%s → 403, no change', async (role) => {
    as(role);
    expect((await PUT(putReq({ autoPauseOffers: true }))).status).toBe(403);
    expect(m.updateConfig).not.toHaveBeenCalled();
  });
});
