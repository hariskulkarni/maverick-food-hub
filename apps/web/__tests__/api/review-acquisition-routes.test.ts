import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  auth: vi.fn(),
  audit: vi.fn(),
  submit: vi.fn(),
  optOut: vi.fn(),
  sweep: vi.fn(),
  listTickets: vi.fn(),
  restaurantStaff: vi.fn(),
  updateTicket: vi.fn(),
  prisma: {
    reviewRequestConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    reviewAutoReplyConfig: { findUnique: vi.fn() },
  },
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ listForRestaurant: vi.fn(async () => []), getConfig: vi.fn(async () => null) }));
vi.mock('@/server/reviews/acquisition', async (orig) => ({
  ...(await orig<typeof import('@/server/reviews/acquisition')>()),
  funnelStats: vi.fn(async () => ({ sent: 0, clicked: 0, feedback: 0, googleClicks: 0, optOuts: 0, qrScans: 0 })),
}));
vi.mock('@/server/reviews/review-link', () => ({ submitFeedbackViaLink: h.submit, optOutViaToken: h.optOut, fetchGbpPlace: vi.fn() }));
vi.mock('@/server/jobs/review-requests-sweep', () => ({ runReviewRequestsSweep: h.sweep }));
vi.mock('@/server/reviews/recovery-admin', () => ({ listTickets: h.listTickets, restaurantStaff: h.restaurantStaff, updateTicket: h.updateTicket }));

import { GET as getCfg, PUT as putCfg } from '@/app/api/admin/reviews/acquisition/route';
import { GET as listRecovery } from '@/app/api/admin/reviews/recovery/route';
import { PATCH as patchTicket } from '@/app/api/admin/reviews/recovery/[id]/route';
import { POST as runJob } from '@/app/api/platform/jobs/review-requests/run/route';
import { POST as linkFeedback } from '@/app/api/review-requests/[token]/feedback/route';
import { POST as linkOptOut } from '@/app/api/review-requests/[token]/opt-out/route';

const TOKEN = 'tok_abcdefghijklmnopqrstu';
const mk = (url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const u = new URL(url, 'http://x');
  return {
    nextUrl: u, url: u.toString(),
    headers: new Headers(headers),
    json: async () => (body === undefined ? null : body),
  } as any;
};
const good = {
  enabled: true, channels: ['SMS', 'EMAIL'], delayMinutes: 60, quietStartHour: 21, quietEndHour: 9,
  reminderEnabled: true, reminderAfterHours: 24, frequencyCapDays: 30, lowRatingThreshold: 3,
  googleReviewUrlOverride: '', whatsappTemplateName: '', whatsappTemplateLang: '',
};
const forbidden = () => new Response('Forbidden', { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
  h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(null);
  h.prisma.reviewAutoReplyConfig.findUnique.mockResolvedValue(null);
});

describe('admin acquisition config', () => {
  it('passes the tenancy rejection through and writes nothing', async () => {
    h.requireManagedRestaurant.mockRejectedValue(forbidden());
    expect((await getCfg(mk('/api/admin/reviews/acquisition'))).status).toBe(403);
    expect((await putCfg(mk('/api/admin/reviews/acquisition', good))).status).toBe(403);
    expect(h.prisma.reviewRequestConfig.upsert).not.toHaveBeenCalled();
  });

  it('GET returns defaults scoped to the managed restaurant', async () => {
    const res = await getCfg(mk('/api/admin/reviews/acquisition'));
    const b = await res.json();
    expect(b.config).toMatchObject({ enabled: false, channels: ['SMS'], lowRatingThreshold: 3 });
    expect(b.googleLink).toEqual({ url: null, source: null });
    expect(h.prisma.reviewRequestConfig.findUnique).toHaveBeenCalledWith({ where: { restaurantId: 'rest1' } });
  });

  it('PUT validates input', async () => {
    for (const bad of [
      { ...good, channels: [] },
      { ...good, channels: ['SMS', 'SMS'] },
      { ...good, channels: ['FAX'] },
      { ...good, quietEndHour: null },
      { ...good, lowRatingThreshold: 5 },
      { ...good, googleReviewUrlOverride: 'javascript:alert(1)' },
      { ...good, delayMinutes: -1 },
    ]) {
      const res = await putCfg(mk('/api/admin/reviews/acquisition', bad));
      expect(res.status).toBe(400);
    }
    expect(h.prisma.reviewRequestConfig.upsert).not.toHaveBeenCalled();
  });

  it('PUT saves for the managed restaurant only and audits', async () => {
    const res = await putCfg(mk('/api/admin/reviews/acquisition', { ...good, googleReviewUrlOverride: 'https://g.page/r/abc/review' }));
    expect(res.status).toBe(200);
    const call = h.prisma.reviewRequestConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ restaurantId: 'rest1' });
    expect(call.update).toMatchObject({ channels: ['SMS', 'EMAIL'], googleReviewUrlOverride: 'https://g.page/r/abc/review', whatsappTemplateName: null });
    expect(h.audit).toHaveBeenCalledWith('reviews.acquisition.config.update', expect.objectContaining({ restaurantId: 'rest1' }));
  });
});

describe('admin recovery tickets', () => {
  it('list is tenancy-scoped and validates status', async () => {
    h.listTickets.mockResolvedValue([]);
    h.restaurantStaff.mockResolvedValue([]);
    expect((await listRecovery(mk('/api/admin/reviews/recovery?status=OPEN'))).status).toBe(200);
    expect(h.listTickets).toHaveBeenCalledWith('rest1', 'OPEN');
    expect((await listRecovery(mk('/api/admin/reviews/recovery?status=NOPE'))).status).toBe(400);
    h.requireManagedRestaurant.mockRejectedValue(forbidden());
    expect((await listRecovery(mk('/api/admin/reviews/recovery'))).status).toBe(403);
  });

  it("PATCH 404s another restaurant's ticket", async () => {
    h.updateTicket.mockResolvedValue(null);
    const res = await patchTicket(mk('/api/admin/reviews/recovery/t9', { status: 'CONTACTED' }), { params: Promise.resolve({ id: 't9' }) });
    expect(res.status).toBe(404);
    expect(h.updateTicket).toHaveBeenCalledWith('rest1', 't9', expect.anything());
  });

  it('PATCH rejects empty bodies, bad statuses and non-member assignees', async () => {
    const p = { params: Promise.resolve({ id: 't1' }) };
    expect((await patchTicket(mk('/x', {}), p)).status).toBe(400);
    expect((await patchTicket(mk('/x', { status: 'CLOSED' }), p)).status).toBe(400);
    h.restaurantStaff.mockResolvedValue([{ id: 'staff1', name: 'A' }]);
    expect((await patchTicket(mk('/x', { assigneeUserId: 'stranger' }), p)).status).toBe(400);
    expect(h.updateTicket).not.toHaveBeenCalled();
  });

  it('PATCH applies and audits a goodwill note', async () => {
    const now = new Date();
    h.updateTicket.mockResolvedValue({
      before: { status: 'OPEN', assigneeUserId: null, goodwillNote: null },
      after: { id: 't1', status: 'RESOLVED', assigneeUserId: null, goodwillNote: 'Refunded', goodwillAt: now, notes: null, contactedAt: null, resolvedAt: now },
    });
    const res = await patchTicket(mk('/x', { status: 'RESOLVED', goodwillNote: 'Refunded' }), { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith('reviews.recovery.update', expect.objectContaining({ entityId: 't1', restaurantId: 'rest1' }));
  });
});

describe('review-requests job route', () => {
  it('requires the internal secret or a super admin', async () => {
    process.env.INTERNAL_CRON_SECRET = 'cron-secret-value';
    h.sweep.mockResolvedValue({ due: 0 });
    expect((await runJob(mk('/run', undefined, { 'x-internal-secret': 'wrong' }))).status).toBe(403);
    expect((await runJob(mk('/run', undefined, {}))).status).toBe(403);
    expect(h.sweep).not.toHaveBeenCalled();
    expect((await runJob(mk('/run', undefined, { 'x-internal-secret': 'cron-secret-value' }))).status).toBe(200);
    h.auth.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    expect((await runJob(mk('/run', undefined, {}))).status).toBe(200);
    expect(h.sweep).toHaveBeenCalledTimes(2);
  });
});

describe('public tracked-link routes', () => {
  const p = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

  it('feedback: 404 for malformed tokens, 400 for bad ratings', async () => {
    expect((await linkFeedback(mk('/x', { rating: 5 }), p('bad'))).status).toBe(404);
    for (const rating of [0, 6, 2.5, '5']) {
      expect((await linkFeedback(mk('/x', { rating }), p())).status).toBe(400);
    }
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('feedback: same googleUrl in the response at every rating', async () => {
    h.submit.mockImplementation(async (_t: string, i: { rating: number }) => ({ ok: true, ticketOpened: i.rating <= 3, googleUrl: 'https://g/review' }));
    const urls = new Set<string>();
    for (const rating of [1, 2, 3, 4, 5]) {
      const res = await linkFeedback(mk('/x', { rating }), p());
      expect(res.status).toBe(201);
      urls.add((await res.json()).googleUrl);
    }
    expect([...urls]).toEqual(['https://g/review']);
  });

  it('feedback: passes through 409 from the service', async () => {
    h.submit.mockResolvedValue({ ok: false, status: 409, error: 'Feedback already submitted' });
    expect((await linkFeedback(mk('/x', { rating: 4 }), p())).status).toBe(409);
  });

  it('opt-out validates scope', async () => {
    h.optOut.mockResolvedValue({ ok: true });
    expect((await linkOptOut(mk('/x', { scope: 'everyone' }), p())).status).toBe(400);
    expect((await linkOptOut(mk('/x', { scope: 'all' }), p())).status).toBe(200);
    expect(h.optOut).toHaveBeenCalledWith(TOKEN, 'all');
  });
});
