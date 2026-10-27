/**
 * Rider insights routes: riders:read only (SUPER_ADMIN + delegated platform
 * roles that hold it). Every other role gets 403 (anonymous 401) and no data
 * is read. Exports are audited. The trip-summary job needs the cron secret or
 * a SUPER_ADMIN session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  session: null as any,
  dbReads: 0,
  audit: vi.fn(async () => {}),
  insights: vi.fn(async () => ({ rider: { id: 'r1' } })),
  deliveryPath: vi.fn(async () => ({ kind: 'delivery', points: [] })),
  shiftPath: vi.fn(async () => ({ kind: 'shift', points: [] })),
  trips: vi.fn(async () => ({ pending: 0, summarized: 0 })),
}));

vi.mock('@/server/auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/audit', () => ({ audit: m.audit }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async () => { m.dbReads++; return { id: 'r1' }; } },
    riderStatusEvent: {
      findMany: async () => {
        m.dbReads++;
        return [{ at: new Date('2026-10-27T04:00:00Z'), type: 'ONLINE', source: 'rider' }];
      },
    },
  },
}));
vi.mock('@/server/rider-insights/service', () => ({
  getRiderInsights: m.insights,
  getDeliveryPath: m.deliveryPath,
  getShiftPath: m.shiftPath,
  SHIFT_PATH_MAX_MS: 24 * 3_600_000,
}));
vi.mock('@/server/rider-insights/trips', () => ({ runTripSummaries: m.trips }));

import { GET as getInsights } from '@/app/api/platform/riders/[id]/insights/route';
import { GET as getPath } from '@/app/api/platform/riders/[id]/insights/path/route';
import { GET as getExport } from '@/app/api/platform/riders/[id]/insights/export/route';
import { POST as runJob } from '@/app/api/platform/jobs/rider-trip-summaries/run/route';
import { NextRequest } from 'next/server';

const ctx = { params: Promise.resolve({ id: 'r1' }) };
const req = (q = '') => new NextRequest(`http://x/api/platform/riders/r1/insights${q}`);
const as = (role: string | null) => (m.session = role ? { user: { id: `u-${role}`, role } } : null);

const calls = [
  ['insights', () => getInsights(req(), ctx)],
  ['path (delivery)', () => getPath(req('?assignmentId=a1'), ctx)],
  ['path (shift)', () => getPath(req('?from=2026-10-27T00:00:00Z&to=2026-10-27T06:00:00Z'), ctx)],
  ['export', () => getExport(req('?kind=timeline'), ctx)],
] as const;

beforeEach(() => {
  m.dbReads = 0;
  m.audit.mockClear();
  m.insights.mockClear();
  m.deliveryPath.mockClear();
  m.shiftPath.mockClear();
  m.trips.mockClear();
});

describe('rider insights access control', () => {
  for (const [name, call] of calls) {
    it.each(['KITCHEN', 'ADMIN', 'DEVELOPER', 'RIDER', 'CUSTOMER'])(`${name}: %s → 403, nothing read`, async (role) => {
      as(role);
      const res = await call();
      expect(res.status).toBe(403);
      expect(m.dbReads).toBe(0);
      expect(m.insights).not.toHaveBeenCalled();
      expect(m.deliveryPath).not.toHaveBeenCalled();
      expect(m.shiftPath).not.toHaveBeenCalled();
    });

    it(`${name}: anonymous → 401`, async () => {
      as(null);
      expect((await call()).status).toBe(401);
      expect(m.dbReads).toBe(0);
    });

    it.each(['SUPER_ADMIN', 'ADMIN_ASSIST', 'QA', 'GUEST'])(`${name}: %s (riders:read) → 200`, async (role) => {
      as(role);
      expect((await call()).status).toBe(200);
    });
  }
});

describe('rider insights export', () => {
  it('returns CSV and writes an audit row', async () => {
    as('SUPER_ADMIN');
    const res = await getExport(req('?kind=timeline'), ctx);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('at_utc,at_ist,event,source');
    expect(body).toContain('ONLINE,rider');
    expect(m.audit).toHaveBeenCalledWith('rider.insights.export', expect.objectContaining({ entityId: 'r1', actorId: 'u-SUPER_ADMIN' }));
  });

  it('rejects an unknown kind and an over-long range', async () => {
    as('SUPER_ADMIN');
    expect((await getExport(req('?kind=contacts'), ctx)).status).toBe(400);
    expect((await getExport(req('?kind=timeline&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z'), ctx)).status).toBe(400);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('shift path is capped at 24 h and needs valid bounds', async () => {
    as('SUPER_ADMIN');
    expect((await getPath(req('?from=2026-10-25T00:00:00Z&to=2026-10-27T00:00:00Z'), ctx)).status).toBe(400);
    expect((await getPath(req('?from=nope&to=2026-10-27T00:00:00Z'), ctx)).status).toBe(400);
    expect(m.shiftPath).not.toHaveBeenCalled();
  });
});

describe('rider-trip-summaries job', () => {
  it('403 for a non-super-admin without the cron secret; runs for SUPER_ADMIN', async () => {
    const post = () => new NextRequest('http://x/api/platform/jobs/rider-trip-summaries/run', { method: 'POST' });
    as('ADMIN_ASSIST');
    expect((await runJob(post())).status).toBe(403);
    expect(m.trips).not.toHaveBeenCalled();
    as('SUPER_ADMIN');
    expect((await runJob(post())).status).toBe(200);
    expect(m.trips).toHaveBeenCalledOnce();
  });
});
