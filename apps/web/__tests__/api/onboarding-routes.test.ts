/**
 * /api/admin/onboarding/* — tenancy, role gating, validation and audit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as any,
  restaurant: { id: 'r1', ownerUserId: 'owner', status: 'ACTIVE', legalName: null, gstin: null, pan: null } as any,
  audits: [] as any[],
  users: {} as Record<string, any>,
  created: [] as string[],
  progressRow: null as any,
  applyCalls: [] as any[],
}));

vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { h.audits.push({ action, ...opts }); } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }), clientIp: () => '1.2.3.4' }));
vi.mock('argon2', () => ({ default: { hash: async () => 'hash' } }));
vi.mock('@/server/tenancy', () => ({
  requireRestaurant: async () => { if (!h.session) throw new Response('nope', { status: 404 }); return h.restaurant; },
  currentRestaurant: async () => (h.session ? h.restaurant : null),
  activeMembership: async () => (h.session ? { restaurant: h.restaurant, role: h.session.user.role, userId: h.session.user.id } : null),
  requireManagedRestaurant: async (rid?: string | null) => {
    if (rid && h.session?.user.role === 'SUPER_ADMIN') return { ...h.restaurant, id: rid };
    if (!h.session) throw new Response('nope', { status: 404 });
    return h.restaurant;
  },
  // Mirrors the real membership-aware gate: 401 signed out, 403 for KITCHEN.
  requireTenantAdmin: async (rid?: string | null) => {
    if (!h.session) throw new Response('signed out', { status: 401 });
    if (rid && h.session.user.role === 'SUPER_ADMIN') return { ...h.restaurant, id: rid };
    if (h.session.user.role !== 'ADMIN') throw new Response('forbidden', { status: 403 });
    return h.restaurant;
  },
}));
vi.mock('@/server/menu-io', () => ({ applyMenuImport: async (branchId: string, rows: any[]) => { h.applyCalls.push({ branchId, rows }); return { created: rows.length, updated: 0, skipped: 0, categoriesCreated: 2 }; } }));
vi.mock('@/server/db', () => ({
  prisma: {
    onboardingProgress: {
      findUnique: async () => h.progressRow,
      upsert: async ({ create, update }: any) => (h.progressRow = { ...(h.progressRow ?? create), ...(h.progressRow ? update : {}) }),
    },
    restaurant: {
      findUnique: async () => ({ name: 'Spice Garden', contactPhone: null, logoUrl: null, gstin: null, ownerUserId: 'owner' }),
      update: async ({ data }: any) => ({ legalName: data.legalName ?? null, gstin: data.gstin ?? null, pan: data.pan ?? null }),
    },
    branch: {
      findMany: async () => [],
      findFirst: async ({ where }: any) => (where.restaurantId === 'r1' && (where.id === undefined || where.id === 'b1') ? { id: 'b1' } : null),
    },
    menuItem: { count: async () => 0 },
    restaurantUser: { count: async () => 0, findMany: async () => [] },
    qrCode: { findFirst: async () => null },
    user: { findUnique: async ({ where }: any) => h.users[where.email] ?? null },
    $transaction: async (fn: any) => fn({
      user: { create: async ({ data }: any) => { h.created.push('user:' + data.role); return { id: 'u2', email: data.email, name: data.name }; } },
      restaurantUser: { create: async ({ data }: any) => { h.created.push(`ru:${data.restaurantId}:${data.role}`); } },
      branchUser: { create: async ({ data }: any) => { h.created.push(`bu:${data.branchId}`); } },
    }),
  },
}));

import { GET, PATCH } from '@/app/api/admin/onboarding/route';
import { POST as goLivePOST } from '@/app/api/admin/onboarding/go-live/route';
import { POST as dismissPOST } from '@/app/api/admin/onboarding/dismiss/route';
import { PATCH as legalPATCH } from '@/app/api/admin/onboarding/legal/route';
import { POST as staffPOST } from '@/app/api/admin/onboarding/staff/route';
import { POST as templatePOST } from '@/app/api/admin/onboarding/menu-template/route';

const req = (url: string, method: string, body?: unknown) => {
  const r = new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as any;
  r.nextUrl = new URL(`http://x${url}`);
  return r;
};
const admin = { user: { id: 'owner', role: 'ADMIN' } };

beforeEach(() => {
  h.session = admin; h.audits = []; h.users = {}; h.created = []; h.progressRow = null; h.applyCalls = [];
});

describe('PATCH /api/admin/onboarding', () => {
  it('401 without a session, 403 for KITCHEN', async () => {
    h.session = null;
    expect((await PATCH(req('/api/admin/onboarding', 'PATCH', { step: 'profile', state: 'done' }))).status).toBe(401);
    h.session = { user: { id: 'k', role: 'KITCHEN' } };
    expect((await PATCH(req('/api/admin/onboarding', 'PATCH', { step: 'profile', state: 'done' }))).status).toBe(403);
  });

  it('400 on unknown step / skipping a required step', async () => {
    expect((await PATCH(req('/api/admin/onboarding', 'PATCH', { step: 'nope' }))).status).toBe(400);
    const r = await PATCH(req('/api/admin/onboarding', 'PATCH', { step: 'menu', state: 'skipped' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/required/);
  });

  it('saves for the caller’s own restaurant and audits state changes', async () => {
    const r = await PATCH(req('/api/admin/onboarding', 'PATCH', { step: 'staff', state: 'skipped', currentStep: 'payments' }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.progress.steps.staff).toBe('skipped');
    expect(h.progressRow.restaurantId).toBe('r1');
    expect(h.audits[0]).toMatchObject({ action: 'onboarding.step.update', restaurantId: 'r1', after: { step: 'staff', state: 'skipped' } });
  });
});

describe('GET /api/admin/onboarding', () => {
  it('returns progress + readiness; super-admin may target another tenant', async () => {
    const j = await (await GET(req('/api/admin/onboarding', 'GET'))).json();
    expect(j.readiness.ready).toBe(false);
    expect(j.progress.started).toBe(false);
    h.session = { user: { id: 's', role: 'SUPER_ADMIN' } };
    expect((await GET(req('/api/admin/onboarding?restaurantId=r9', 'GET'))).status).toBe(200);
  });
});

describe('go-live + dismiss', () => {
  it('409 with failing checks when not ready; nothing persisted', async () => {
    const r = await goLivePOST(req('/api/admin/onboarding/go-live', 'POST'));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.reason).toBe('not_ready');
    expect(j.readiness.checks.find((c: any) => c.key === 'menu').ok).toBe(false);
    expect(h.progressRow).toBeNull();
    expect(h.audits).toHaveLength(0);
  });
  it('dismiss refuses before completion', async () => {
    expect((await dismissPOST(req('/api/admin/onboarding/dismiss', 'POST'))).status).toBe(409);
  });
});

describe('PATCH /api/admin/onboarding/legal', () => {
  it('rejects a GSTIN with a bad checksum and a PAN mismatch', async () => {
    const r = await legalPATCH(req('/api/admin/onboarding/legal', 'PATCH', { gstin: '27AAPFU0939F1ZW' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/checksum/);
    const m = await legalPATCH(req('/api/admin/onboarding/legal', 'PATCH', { gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' }));
    expect(m.status).toBe(400);
  });
  it('normalises + saves valid values and audits', async () => {
    const r = await legalPATCH(req('/api/admin/onboarding/legal', 'PATCH', { gstin: '27aapfu0939f1zv', pan: 'aapfu0939f', legalName: ' Spice Garden Foods LLP ' }));
    expect(r.status).toBe(200);
    expect((await r.json()).legal).toEqual({ legalName: 'Spice Garden Foods LLP', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F' });
    expect(h.audits[0]).toMatchObject({ action: 'restaurant.settings.update', restaurantId: 'r1' });
  });
});

describe('POST /api/admin/onboarding/staff', () => {
  const body = { name: 'Ravi Kumar', email: 'ravi@spicegarden.in', role: 'KITCHEN', branchId: 'b1' };
  it('KITCHEN users cannot invite', async () => {
    h.session = { user: { id: 'k', role: 'KITCHEN' } };
    expect((await staffPOST(req('/api/admin/onboarding/staff', 'POST', body))).status).toBe(403);
  });
  it('404 for a branch of another restaurant, 409 for an existing email', async () => {
    expect((await staffPOST(req('/api/admin/onboarding/staff', 'POST', { ...body, branchId: 'other-b' }))).status).toBe(404);
    h.users['ravi@spicegarden.in'] = { id: 'x' };
    expect((await staffPOST(req('/api/admin/onboarding/staff', 'POST', body))).status).toBe(409);
    expect(h.created).toHaveLength(0);
  });
  it('creates the user in the caller’s restaurant, returns the temp password once, audits without it', async () => {
    const r = await staffPOST(req('/api/admin/onboarding/staff', 'POST', body));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.tempPassword).toHaveLength(14);
    expect(h.created).toEqual(['user:KITCHEN', 'ru:r1:KITCHEN', 'bu:b1']);
    expect(JSON.stringify(h.audits)).not.toContain(j.tempPassword);
    expect(h.audits[0]).toMatchObject({ action: 'user.create', restaurantId: 'r1' });
  });
  it('400 on an invalid email', async () => {
    expect((await staffPOST(req('/api/admin/onboarding/staff', 'POST', { ...body, email: 'nope' }))).status).toBe(400);
  });
});

describe('POST /api/admin/onboarding/menu-template', () => {
  it('400 for an unknown template, applies edits via the import engine for the active branch', async () => {
    expect((await templatePOST(req('/api/admin/onboarding/menu-template', 'POST', { templateId: 'thai' }))).status).toBe(400);
    const r = await templatePOST(req('/api/admin/onboarding/menu-template', 'POST', {
      templateId: 'south-indian', selections: [{ index: 0, include: false }, { index: 1, include: true, price: 75 }],
    }));
    expect(r.status).toBe(200);
    expect(h.applyCalls[0].branchId).toBe('b1');
    expect(h.applyCalls[0].rows[0]).toMatchObject({ name: 'Medu Vada', price: 75 });
    expect(h.audits[0]).toMatchObject({ action: 'menu.template.apply', restaurantId: 'r1' });
  });
  it('403 for non-admin roles', async () => {
    h.session = { user: { id: 'k', role: 'KITCHEN' } };
    expect((await templatePOST(req('/api/admin/onboarding/menu-template', 'POST', { templateId: 'pizza' }))).status).toBe(403);
  });
});
