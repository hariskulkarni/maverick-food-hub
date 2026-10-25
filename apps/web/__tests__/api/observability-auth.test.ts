/**
 * Every Observability Center API is SUPER_ADMIN + 2FA only. This walks every
 * route file under src/app/api/platform/observability/** (plus the obs jobs)
 * and proves each exported handler refuses every other role, refuses a
 * super-admin without a 2FA session, and returns 401 with no session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  user: { findUnique: vi.fn() },
  userSession: { findUnique: vi.fn() },
  audit: vi.fn(),
}));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({
  prisma: new Proxy(
    { user: h.user, userSession: h.userSession },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        // Any other model access means the gate let the request through.
        throw new Error(`unexpected prisma access: ${String(prop)}`);
      },
    },
  ),
}));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ROOT = path.resolve(__dirname, '../../src/app/api/platform/observability');
function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : [],
  );
}
const FILES = [
  ...routeFiles(ROOT),
  path.resolve(__dirname, '../../src/app/api/platform/jobs/obs-alerts/run/route.ts'),
  path.resolve(__dirname, '../../src/app/api/platform/jobs/obs-retention/run/route.ts'),
];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const req = (url = 'http://x/api/platform/observability/x') => {
  const u = new URL(url);
  return { nextUrl: u, url: u.toString(), headers: new Headers(), json: async () => ({ action: 'evaluate' }), text: async () => '' } as never;
};
const ctx = { params: Promise.resolve({ id: 'abc' }) } as never;

const NON_SUPER = ['ADMIN', 'KITCHEN', 'ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST', 'RIDER', 'CUSTOMER'];

async function handlers() {
  const out: Array<{ name: string; fn: (r: never, c: never) => Promise<Response> }> = [];
  for (const f of FILES) {
    const mod = (await import(f)) as Record<string, unknown>;
    for (const m of METHODS) if (typeof mod[m] === 'function') out.push({ name: `${m} ${path.relative(ROOT, f)}`, fn: mod[m] as never });
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERNAL_CRON_SECRET;
});

describe('observability API authorization', () => {
  it('covers every route file (sanity)', async () => {
    const all = await handlers();
    expect(FILES.length).toBeGreaterThanOrEqual(14);
    expect(all.length).toBeGreaterThanOrEqual(16);
  });

  it.each(NON_SUPER)('403 for role %s on every handler', async (role) => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role } });
    h.user.findUnique.mockResolvedValue({ role, email: 'x@y.z', totpEnabledAt: new Date(0), currentSessionId: 's1' });
    for (const { name, fn } of await handlers()) {
      const res = await fn(req(), ctx);
      expect(res.status, name).toBe(403);
    }
  });

  it('401 (or 403 for cron routes) with no session', async () => {
    h.auth.mockResolvedValue(null);
    for (const { name, fn } of await handlers()) {
      const res = await fn(req(), ctx);
      expect([401, 403], name).toContain(res.status);
    }
  });

  it('403 for a SUPER_ADMIN without a 2FA session (not enrolled / pre-enrolment session / break-glass)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    const cases = [
      { user: { role: 'SUPER_ADMIN', email: 'a@b.c', totpEnabledAt: null, currentSessionId: 's1' }, session: { createdAt: new Date(), revokedAt: null } },
      { user: { role: 'SUPER_ADMIN', email: 'a@b.c', totpEnabledAt: new Date('2026-10-02'), currentSessionId: 's1' }, session: { createdAt: new Date('2026-10-01'), revokedAt: null } },
      { user: { role: 'SUPER_ADMIN', email: 'glass@b.c', totpEnabledAt: new Date('2026-10-01'), currentSessionId: 's1' }, session: { createdAt: new Date('2026-10-02'), revokedAt: null } },
    ];
    process.env.BREAKGLASS_EMAILS = 'glass@b.c';
    for (const c of cases) {
      h.user.findUnique.mockResolvedValue(c.user);
      h.userSession.findUnique.mockResolvedValue(c.session);
      for (const { name, fn } of await handlers()) {
        const res = await fn(req(), ctx);
        expect(res.status, `${name} ${JSON.stringify(c.user)}`).toBe(403);
      }
    }
    delete process.env.BREAKGLASS_EMAILS;
  });

  it('a SUPER_ADMIN with a 2FA session passes the gate', async () => {
    h.auth.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    h.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN', email: 'a@b.c', totpEnabledAt: new Date('2026-10-01'), currentSessionId: 's1' });
    h.userSession.findUnique.mockResolvedValue({ createdAt: new Date('2026-10-02'), revokedAt: null });
    const mod = await import('@/app/api/platform/observability/alerts/mutes/route');
    // Past the gate, validation runs: an empty key is a 400, not a 401/403.
    const res = await mod.DELETE(req('http://x/api/platform/observability/alerts/mutes'));
    expect(res.status).toBe(400);
  });
});

describe('decideObservabilityAccess', () => {
  it('pure decision table', async () => {
    const { decideObservabilityAccess } = await import('@/server/observability/access');
    const t = new Date('2026-10-01');
    const later = new Date('2026-10-02');
    expect(decideObservabilityAccess({ role: null, email: null, totpEnabledAt: null, sessionStartedAt: null })).toBe('unauthenticated');
    expect(decideObservabilityAccess({ role: 'DEVELOPER', email: 'd@x', totpEnabledAt: t, sessionStartedAt: later })).toBe('role');
    expect(decideObservabilityAccess({ role: 'SUPER_ADMIN', email: 's@x', totpEnabledAt: null, sessionStartedAt: later })).toBe('2fa');
    expect(decideObservabilityAccess({ role: 'SUPER_ADMIN', email: 's@x', totpEnabledAt: later, sessionStartedAt: t })).toBe('2fa');
    expect(decideObservabilityAccess({ role: 'SUPER_ADMIN', email: 's@x', totpEnabledAt: t, sessionStartedAt: null })).toBe('2fa');
    expect(decideObservabilityAccess({ role: 'SUPER_ADMIN', email: 's@x', totpEnabledAt: t, sessionStartedAt: later })).toBeNull();
  });

  it('no platform role other than SUPER_ADMIN holds platform:admin (observability page gate)', async () => {
    const { ROLE_CAPABILITIES, pageGateFor } = await import('@/server/permissions');
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      if (role !== 'SUPER_ADMIN') expect(caps.has('platform:admin'), role).toBe(false);
    }
    expect(pageGateFor('/platform/observability')).toBe('platform:admin');
  });
});
