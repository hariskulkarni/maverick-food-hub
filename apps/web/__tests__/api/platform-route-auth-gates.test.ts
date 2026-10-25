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
