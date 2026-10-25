/**
 * Training routes — auth + tenancy wiring (service layer mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  riderSession: null as any,
  webSession: null as any,
  restaurant: null as any,
  userFind: vi.fn(),
  profileUpdate: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  report: vi.fn(),
  blockers: vi.fn(),
  apply: vi.fn(),
  moduleFind: vi.fn(),
}));

vi.mock('@/server/rider-auth', () => ({ auth: async () => m.riderSession }));
vi.mock('@/server/auth', () => ({ auth: async () => m.webSession }));
vi.mock('@/server/tenancy', () => ({ currentRestaurant: async () => m.restaurant }));
vi.mock('@/server/audit', () => ({ audit: () => Promise.resolve() }));
vi.mock('@/server/db', () => ({
  prisma: {
    user: { findUnique: m.userFind },
    riderProfile: { update: m.profileUpdate },
    trainingModule: { findUnique: m.moduleFind, findUniqueOrThrow: m.moduleFind },
    $transaction: async (fn: any) => fn({}),
  },
}));
vi.mock('@/server/training/service', () => ({
  listLearnerModules: m.list,
  submitQuiz: m.submit,
  shiftGateBlockers: m.blockers,
  getLearnerModule: vi.fn(),
  legacyComplete: vi.fn(),
  completeLesson: vi.fn(),
  listCertificates: vi.fn(),
}));
vi.mock('@/server/training/report', async (orig) => ({ ...(await orig<any>()), buildTrainingReport: m.report }));
vi.mock('@/server/training/authoring', async (orig) => ({
  ...(await orig<any>()),
  applyModuleContent: m.apply,
  loadModuleForEditor: vi.fn(async () => ({ id: 'mod1' })),
}));

import { GET as riderList } from '@/app/api/rider/training/route';
import { POST as riderQuiz } from '@/app/api/rider/training/[id]/quiz/route';
import { GET as staffList } from '@/app/api/staff/training/route';
import { GET as teamGet } from '@/app/api/staff/training/team/route';
import { GET as reportGet } from '@/app/api/platform/training-modules/report/route';
import { PATCH as modulePatch } from '@/app/api/platform/training-modules/[id]/route';
import { PUT as settingsPut } from '@/app/api/platform/training-modules/settings/route';
import { POST as online } from '@/app/api/rider/online/route';

const req = (url: string, body?: unknown) =>
  ({ nextUrl: new URL(url, 'http://x.test'), json: async () => body, headers: new Headers() }) as any;
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  m.riderSession = null;
  m.webSession = null;
  m.restaurant = null;
  m.list.mockResolvedValue({ modules: [], completedCount: 0, totalCount: 0, requiredRemaining: 0 });
  m.report.mockResolvedValue({ generatedAt: '2026-10-24T00:00:00.000Z', modules: [], learners: [] });
  m.userFind.mockResolvedValue({ id: 'u1', role: 'RIDER', createdAt: new Date(), riderProfile: { id: 'rp1', preferences: { preferredLanguage: 'hi' } } });
});

describe('rider training routes', () => {
  it('403 for non-riders (same as pre-v2)', async () => {
    m.riderSession = { user: { id: 'u1', role: 'CUSTOMER' } };
    expect((await riderList(req('/api/rider/training'))).status).toBe(403);
  });

  it('uses the rider language preference when no ?lang is given', async () => {
    m.riderSession = { user: { id: 'u1', role: 'RIDER' } };
    const res = await riderList(req('/api/rider/training'));
    expect(res.status).toBe(200);
    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'hi');
    await riderList(req('/api/rider/training?lang=en'));
    expect(m.list).toHaveBeenLastCalledWith(expect.anything(), 'en');
  });

  it('quiz rejects a malformed body and maps service errors to status codes', async () => {
    m.riderSession = { user: { id: 'u1', role: 'RIDER' } };
    expect((await riderQuiz(req('/x', { answers: 'nope' }), ctx({ id: 'mod1' }))).status).toBe(400);
    m.submit.mockResolvedValue({ error: 'wait', code: 'training/not_allowed', status: 409, reason: 'cooldown' });
    const res = await riderQuiz(req('/x', { answers: { q1: 1 } }), ctx({ id: 'mod1' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: 'cooldown' });
  });
});

describe('staff training routes', () => {
  it('401 without a session, 403 for riders/customers, 403 when no restaurant is linked', async () => {
    expect((await staffList(req('/x'))).status).toBe(401);
    m.webSession = { user: { id: 'u2', role: 'RIDER' } };
    expect((await staffList(req('/x'))).status).toBe(403);
    m.webSession = { user: { id: 'u2', role: 'KITCHEN' } };
    expect((await staffList(req('/x'))).status).toBe(403);
  });

  it('kitchen staff get their library', async () => {
    m.webSession = { user: { id: 'u2', role: 'KITCHEN' } };
    m.restaurant = { id: 'r1' };
    m.userFind.mockResolvedValue({ id: 'u2', role: 'KITCHEN', createdAt: new Date() });
    expect((await staffList(req('/x'))).status).toBe(200);
  });

  it('team view: kitchen forbidden; admin scoped to their current restaurant', async () => {
    m.restaurant = { id: 'r1' };
    m.webSession = { user: { id: 'u2', role: 'KITCHEN' } };
    m.userFind.mockResolvedValue({ id: 'u2', role: 'KITCHEN', createdAt: new Date() });
    expect((await teamGet(req('/x'))).status).toBe(403);
    m.webSession = { user: { id: 'u3', role: 'ADMIN' } };
    m.userFind.mockResolvedValue({ id: 'u3', role: 'ADMIN', createdAt: new Date() });
    const res = await teamGet(req('/x?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(m.report).toHaveBeenCalledWith({ audiences: ['KITCHEN', 'RESTAURANT_ADMIN'], restaurantId: 'r1' });
  });
});

describe('platform training routes', () => {
  it('report needs riders:read (DEVELOPER has cms only)', async () => {
    m.webSession = { user: { id: 'd', role: 'DEVELOPER' } };
    expect((await reportGet(req('/x'))).status).toBe(403);
    m.webSession = { user: { id: 'g', role: 'GUEST' } };
    expect((await reportGet(req('/x?audience=KITCHEN'))).status).toBe(200);
    expect(m.report).toHaveBeenCalledWith({ audiences: ['KITCHEN'] });
  });

  it('editing and the shift-gate setting are super-admin only', async () => {
    m.webSession = { user: { id: 'a', role: 'ADMIN_ASSIST' } };
    expect((await modulePatch(req('/x', { title: 'New title' }), ctx({ id: 'mod1' }))).status).toBe(403);
    expect((await settingsPut(req('/x', { shiftGate: true }))).status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('refuses to publish a module with no lessons', async () => {
    m.webSession = { user: { id: 's', role: 'SUPER_ADMIN' } };
    m.moduleFind.mockResolvedValue({ id: 'mod1', contentBody: '', contentBlocks: null, _count: { lessons: 0, questions: 0 } });
    const res = await modulePatch(req('/x', { isActive: true }), ctx({ id: 'mod1' }));
    expect(res.status).toBe(400);
    expect(m.apply).not.toHaveBeenCalled();
  });
});

describe('rider online gate', () => {
  it('blocks going online with missing shift-blocking modules, never blocks going offline', async () => {
    m.riderSession = { user: { id: 'u1', role: 'RIDER' } };
    m.blockers.mockResolvedValue([{ moduleId: 'mod1', title: 'Road safety', overdue: false, needsRecert: false }]);
    const res = await online(req('/x', { online: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'training/required', modules: [{ id: 'mod1', title: 'Road safety' }] });
    expect(m.profileUpdate).not.toHaveBeenCalled();

    m.profileUpdate.mockResolvedValue({ isOnline: false });
    expect((await online(req('/x', { online: false }))).status).toBe(200);
    expect(m.blockers).toHaveBeenCalledTimes(1);
  });

  it('goes online when nothing blocks (gate off or modules passed)', async () => {
    m.riderSession = { user: { id: 'u1', role: 'RIDER' } };
    m.blockers.mockResolvedValue([]);
    m.profileUpdate.mockResolvedValue({ isOnline: true });
    expect((await online(req('/x', { online: true }))).status).toBe(200);
  });
});
