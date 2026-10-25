import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(), audit: vi.fn(), settings: vi.fn(), recent: vi.fn(),
  sendDigest: vi.fn(), runReviewDigest: vi.fn(), cached: vi.fn(), refresh: vi.fn(), session: null as any,
  db: {
    reviewResponseSettings: { upsert: vi.fn() },
    reviewReplyTemplate: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('@/server/reviews/review-audit', () => ({ auditReview: h.audit }));
vi.mock('@/server/reviews/store', () => ({ getResponseSettings: h.settings, recentPostedReplies: h.recent }));
vi.mock('@/server/jobs/review-digest', () => ({ sendDigest: h.sendDigest, runReviewDigest: h.runReviewDigest }));
vi.mock('@/server/reviews/insights', () => ({ getCachedInsights: h.cached, refreshInsights: h.refresh }));

import { GET as getSettings, PUT as putSettings } from '@/app/api/admin/reviews/response-settings/route';
import { GET as listTpl, POST as createTpl } from '@/app/api/admin/reviews/templates/route';
import { PATCH as patchTpl, DELETE as delTpl } from '@/app/api/admin/reviews/templates/[id]/route';
import { POST as voice } from '@/app/api/admin/reviews/brand-voice/route';
import { POST as testDigest } from '@/app/api/admin/reviews/digest/test/route';
import { GET as insights } from '@/app/api/admin/reviews/insights/route';
import { POST as digestJob } from '@/app/api/platform/jobs/review-digest/run/route';

const req = (method: string, body?: unknown, url = 'http://x/api') =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id = 't1') => ({ params: Promise.resolve({ id }) });
const DEFAULTS = {
  skipKeywords: ['refund'], brandVoiceSummary: null, brandVoiceUpdatedAt: null, alertEnabled: true, alertMaxRating: 2,
  alertSms: false, alertWhatsapp: false, slaHours: 24, escalationEmail: null, escalationPhone: null,
  digestEnabled: false, digestSms: false, digestWhatsapp: false, digestLastSentAt: null,
  googleAverageRating: 4.1, googleTotalReviewCount: 10, restaurantId: 'rest1',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.settings.mockResolvedValue(DEFAULTS);
});

describe('response settings route', () => {
  it('GET returns the DTO (no internal Google totals)', async () => {
    const json = await (await getSettings(req('GET'))).json();
    expect(json.slaHours).toBe(24);
    expect(json).not.toHaveProperty('googleAverageRating');
    expect(json).not.toHaveProperty('restaurantId');
  });
  it('PUT validates, normalises keywords, upserts tenant-scoped and audits', async () => {
    h.db.reviewResponseSettings.upsert.mockImplementation(async (a: any) => ({ ...DEFAULTS, ...a.update }));
    const res = await putSettings(req('PUT', { skipKeywords: ['Refund', 'refund', 'Allergy'], slaHours: 12, escalationEmail: '' }));
    expect(res.status).toBe(200);
    const arg = h.db.reviewResponseSettings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ restaurantId: 'rest1' });
    expect(arg.update).toEqual({ skipKeywords: ['refund', 'allergy'], slaHours: 12, escalationEmail: null });
    expect(h.audit).toHaveBeenCalledWith('reviews.settings.update', 'rest1', expect.objectContaining({ after: arg.update }));
  });
  it('PUT rejects bad input with 400', async () => {
    expect((await putSettings(req('PUT', { slaHours: 0 }))).status).toBe(400);
    expect((await putSettings(req('PUT', { alertMaxRating: 5 }))).status).toBe(400);
    expect((await putSettings(req('PUT', { escalationEmail: 'nope' }))).status).toBe(400);
    expect(h.db.reviewResponseSettings.upsert).not.toHaveBeenCalled();
  });
});

describe('templates routes', () => {
  it('lists tenant templates', async () => {
    h.db.reviewReplyTemplate.findMany.mockResolvedValue([{ id: 't1', name: 'A', body: 'B', updatedAt: new Date(), restaurantId: 'rest1' }]);
    const json = await (await listTpl(req('GET'))).json();
    expect(json.templates[0]).toEqual({ id: 't1', name: 'A', body: 'B', updatedAt: expect.any(String) });
    expect(h.db.reviewReplyTemplate.findMany.mock.calls[0][0].where).toEqual({ restaurantId: 'rest1' });
  });
  it('creates one template, or the starter set, and audits', async () => {
    h.db.reviewReplyTemplate.count.mockResolvedValue(0);
    h.db.reviewReplyTemplate.create.mockImplementation(async (a: any) => ({ id: 'n', updatedAt: new Date(), ...a.data }));
    expect((await createTpl(req('POST', { name: 'Thanks', body: 'Thanks {name}!' }))).status).toBe(201);
    expect(h.db.reviewReplyTemplate.create).toHaveBeenCalledWith({ data: { restaurantId: 'rest1', name: 'Thanks', body: 'Thanks {name}!' } });
    h.db.reviewReplyTemplate.create.mockClear();
    await createTpl(req('POST', { starter: true }));
    expect(h.db.reviewReplyTemplate.create).toHaveBeenCalledTimes(3);
    expect(h.audit).toHaveBeenCalledWith('reviews.template.create', 'rest1', expect.anything());
  });
  it('enforces the template cap and validation', async () => {
    h.db.reviewReplyTemplate.count.mockResolvedValue(30);
    expect((await createTpl(req('POST', { name: 'x', body: 'y' }))).status).toBe(400);
    expect((await createTpl(req('POST', { name: '', body: 'y' }))).status).toBe(400);
  });
  it('PATCH/DELETE are tenant-scoped and 404 for foreign ids', async () => {
    h.db.reviewReplyTemplate.updateMany.mockResolvedValue({ count: 0 });
    expect((await patchTpl(req('PATCH', { name: 'a', body: 'b' }), ctx())).status).toBe(404);
    expect(h.db.reviewReplyTemplate.updateMany.mock.calls[0][0].where).toEqual({ id: 't1', restaurantId: 'rest1' });
    h.db.reviewReplyTemplate.deleteMany.mockResolvedValue({ count: 1 });
    expect((await delTpl(req('DELETE'), ctx())).status).toBe(200);
    expect(h.db.reviewReplyTemplate.deleteMany).toHaveBeenCalledWith({ where: { id: 't1', restaurantId: 'rest1' } });
    expect(h.audit).toHaveBeenCalledWith('reviews.template.delete', 'rest1', expect.objectContaining({ entityId: 't1' }));
  });
});

describe('brand voice route', () => {
  it('re-learns from recent posted replies and stores the summary', async () => {
    h.recent.mockResolvedValue(['Thanks! - Team A', 'Glad you liked it! - Team A', 'Thank you! - Team A']);
    const json = await (await voice(req('POST'))).json();
    expect(json.samples).toBe(3);
    expect(json.brandVoiceSummary).toContain('Team A');
    expect(h.db.reviewResponseSettings.upsert.mock.calls[0][0].where).toEqual({ restaurantId: 'rest1' });
  });
});

describe('test digest route', () => {
  it('sends now using the configured channels and audits', async () => {
    h.sendDigest.mockResolvedValue({ recipients: 2, sent: 2 });
    const res = await testDigest(req('POST'));
    expect(await res.json()).toEqual({ ok: true, recipients: 2, sent: 2 });
    expect(h.sendDigest).toHaveBeenCalledWith('rest1', { channels: { sms: false, whatsapp: false } });
    expect(h.audit).toHaveBeenCalledWith('reviews.digest.test', 'rest1', expect.anything());
  });
  it('409 when there is nobody to email', async () => {
    h.sendDigest.mockResolvedValue({ recipients: 0, sent: 0 });
    expect((await testDigest(req('POST'))).status).toBe(409);
  });
});

describe('insights route', () => {
  it('serves the cached snapshot', async () => {
    h.cached.mockResolvedValue({ data: { totals: { reviews: 3 } }, computedAt: new Date('2026-10-24') });
    const json = await (await insights(req('GET'))).json();
    expect(json.totals.reviews).toBe(3);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('computes when missing or on ?refresh=1', async () => {
    h.refresh.mockResolvedValue({ totals: { reviews: 0 } });
    await insights(req('GET', undefined, 'http://x/api?refresh=1'));
    expect(h.cached).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalledWith('rest1');
  });
  it('tenancy errors pass through', async () => {
    h.requireManagedRestaurant.mockRejectedValue(new Response('No restaurant', { status: 404 }));
    expect((await insights(req('GET'))).status).toBe(404);
  });
});

describe('review digest job route', () => {
  it('403 without secret or super admin; runs with the right secret', async () => {
    process.env.INTERNAL_CRON_SECRET = 'cron-secret';
    expect((await digestJob(req('POST'))).status).toBe(403);
    const bad = new NextRequest('http://x', { method: 'POST', headers: { 'x-internal-secret': 'cron-secreT' } });
    expect((await digestJob(bad)).status).toBe(403);
    const short = new NextRequest('http://x', { method: 'POST', headers: { 'x-internal-secret': 'c' } });
    expect((await digestJob(short)).status).toBe(403);
    h.runReviewDigest.mockResolvedValue({ restaurants: 1, sent: 1, skipped: 0, failed: 0 });
    const ok = new NextRequest('http://x', { method: 'POST', headers: { 'x-internal-secret': 'cron-secret' } });
    const json = await (await digestJob(ok)).json();
    expect(json).toMatchObject({ ok: true, sent: 1 });
  });
  it('super admin session may run it', async () => {
    delete process.env.INTERNAL_CRON_SECRET;
    h.session = { user: { role: 'SUPER_ADMIN' } };
    h.runReviewDigest.mockResolvedValue({ restaurants: 0, sent: 0, skipped: 0, failed: 0 });
    expect((await digestJob(req('POST'))).status).toBe(200);
  });
});
