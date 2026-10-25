/**
 * UNVERIFIED item, now verified: Next 15 route handlers re-throw anything that
 * is not a redirect / notFound error (next/dist/server/route-modules/app-route
 * /module.js), so `throw new Response('Forbidden', {status:403})` from
 * requireSuperAdmin()/requireCapability() surfaced as a 500. These platform
 * routes now use the non-throwing api-auth gates: wrong role → 403, no
 * session → 401, and the database is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
const dbTouched = vi.fn();
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy(() => {}, { get: () => () => { dbTouched(); throw new Error('db must not be touched'); }, apply: () => { dbTouched(); throw new Error('db'); } }) }),
}));

const routes: Array<[string, () => Promise<any>]> = [
  ['brands', () => import('@/app/api/platform/brands/route')],
  ['feedback', () => import('@/app/api/platform/feedback/route')],
  ['messages', () => import('@/app/api/platform/messages/route')],
  ['observability/errors', () => import('@/app/api/platform/observability/errors/route')],
  ['restaurants/picker', () => import('@/app/api/platform/restaurants/picker/route')],
  ['signup-bonus/grants', () => import('@/app/api/platform/signup-bonus/grants/route')],
  ['support', () => import('@/app/api/platform/support/route')],
  ['surge-zones', () => import('@/app/api/platform/surge-zones/route')],
  // Runtime check (login-check B4b) saw these two 500 for ADMIN/KITCHEN.
  ['security', () => import('@/app/api/platform/security/route')],
  ['users/[id]', () => import('@/app/api/platform/users/[id]/route')],
  ['cod', () => import('@/app/api/platform/cod/route')],
  ['reports/gmv-by-day', () => import('@/app/api/platform/reports/gmv-by-day/route')],
  ['rider-payouts', () => import('@/app/api/platform/rider-payouts/route')],
  ['kyc', () => import('@/app/api/platform/kyc/route')],
  ['settlements', () => import('@/app/api/platform/settlements/route')],
  ['riders/live', () => import('@/app/api/platform/riders/live/route')],
  ['rider-sos', () => import('@/app/api/platform/rider-sos/route')],
];

const req = () => new Request('http://x/api/platform/x') as any;
const ctx = { params: Promise.resolve({ id: 'x' }) };

beforeEach(() => { dbTouched.mockClear(); });

describe('platform routes return 401/403 instead of a thrown-Response 500', () => {
  for (const [name, load] of routes) {
    it(`${name}: KITCHEN -> 403, anonymous -> 401`, async () => {
      const mod = await load();
      session = { user: { id: 'k1', role: 'KITCHEN' } };
      expect((await mod.GET(req(), ctx)).status).toBe(403);
      session = null;
      expect((await mod.GET(req(), ctx)).status).toBe(401);
      expect(dbTouched).not.toHaveBeenCalled();
    });
  }
});

describe('guard: no /api/platform route uses a throwing gate without catching it', () => {
  it('every requireSuperAdmin()/requireCapability() call site is inside a Response-catching handler', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../src/app/api/platform');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'route.ts') {
          const s = fs.readFileSync(p, 'utf8');
          if (/await require(SuperAdmin\(\)|Capability\()/.test(s) && !/catch\s*\((\w+)[^)]*\)\s*\{[^}]*\1 instanceof Response/.test(s)) {
            offenders.push(path.relative(root, p));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
