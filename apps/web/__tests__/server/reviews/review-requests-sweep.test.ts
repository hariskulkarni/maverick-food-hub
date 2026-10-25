import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sms: vi.fn(),
  email: vi.fn(),
  getConfig: vi.fn(),
  prisma: {
    reviewRequest: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    reviewRequestConfig: { findUnique: vi.fn() },
    reviewRequestOptOut: { findFirst: vi.fn() },
    notificationLog: { create: vi.fn() },
  },
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms, email: h.email, whatsapp: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));

import { runReviewRequestsSweep } from '@/server/jobs/review-requests-sweep';

// 12:00 IST — outside default quiet hours (21 → 9)
const NOON = new Date('2026-10-24T06:30:00Z');
const NIGHT = new Date('2026-10-24T17:30:00Z'); // 23:00 IST

const cfgRow = (over: Record<string, unknown> = {}) => ({
  enabled: true, channels: ['SMS'], delayMinutes: 60, quietStartHour: 21, quietEndHour: 9,
  reminderEnabled: true, reminderAfterHours: 24, frequencyCapDays: 30, lowRatingThreshold: 3,
  gbpPlaceId: null, gbpReviewUrl: null, googleReviewUrlOverride: null, whatsappTemplateName: null, whatsappTemplateLang: null,
  ...over,
});
const req = (over: Record<string, unknown> = {}) => ({
  id: 'rr1', restaurantId: 'r1', orderId: 'o1', customerId: 'u1', token: 'tok_abcdefghijklmnopqrstu', channel: 'SMS',
  status: 'SCHEDULED', dueAt: new Date(NOON.getTime() - 60_000), reminderDueAt: null,
  order: { code: 'ORD-1', feedback: null, customer: { id: 'u1', phone: '+919999999999', email: 'c@x.in' } },
  restaurant: { name: 'Spice Hub' },
  ...over,
});

function queue(due: unknown[], reminders: unknown[] = []) {
  h.prisma.reviewRequest.findMany.mockResolvedValueOnce(due).mockResolvedValueOnce(reminders);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.reviewRequest.findMany.mockReset();
  h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfgRow());
  h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue(null);
  h.prisma.reviewRequest.count.mockResolvedValue(0);
  h.prisma.reviewRequest.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.reviewRequest.update.mockResolvedValue({});
  h.sms.mockResolvedValue({ ok: true });
  h.email.mockResolvedValue({ ok: true });
  h.getConfig.mockResolvedValue(null);
});

describe('runReviewRequestsSweep — first asks', () => {
  it('claims then sends a due ask with tracked + STOP links and schedules the reminder', async () => {
    queue([req()]);
    const r = await runReviewRequestsSweep(NOON);
    expect(r.sent).toBe(1);
    const claim = h.prisma.reviewRequest.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'rr1', status: 'SCHEDULED' });
    expect(claim.data).toMatchObject({ status: 'SENT', sentAt: NOON, channel: 'SMS' });
    expect(claim.data.reminderDueAt.getTime()).toBe(NOON.getTime() + 24 * 3_600_000);
    const body = h.sms.mock.calls[0][0].body as string;
    expect(body).toContain('/rv/tok_abcdefghijklmnopqrstu');
    expect(body).toContain('/rv/tok_abcdefghijklmnopqrstu/stop');
    expect(body).toContain('ORD-1');
  });

  it('is idempotent: a lost claim (another run won) sends nothing', async () => {
    queue([req()]);
    h.prisma.reviewRequest.updateMany.mockResolvedValue({ count: 0 });
    const r = await runReviewRequestsSweep(NOON);
    expect(h.sms).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
  });

  it('honours opt-out (restaurant or global)', async () => {
    queue([req()]);
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue({ id: 'oo1' });
    const r = await runReviewRequestsSweep(NOON);
    expect(h.sms).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(h.prisma.reviewRequestOptOut.findFirst.mock.calls[0][0].where).toEqual({
      customerId: 'u1', OR: [{ restaurantId: 'r1' }, { restaurantId: null }],
    });
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({ where: { id: 'rr1', status: 'SCHEDULED' }, data: { status: 'SKIPPED', error: 'opted_out' } });
  });

  it('applies the per-customer frequency cap', async () => {
    queue([req()]);
    h.prisma.reviewRequest.count.mockResolvedValue(1);
    await runReviewRequestsSweep(NOON);
    expect(h.sms).not.toHaveBeenCalled();
    const where = h.prisma.reviewRequest.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ customerId: 'u1', restaurantId: 'r1', id: { not: 'rr1' } });
    expect(where.sentAt.gte.getTime()).toBe(NOON.getTime() - 30 * 86_400_000);
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].data.error).toBe('frequency_cap');
  });

  it('defers during quiet hours without changing the row', async () => {
    queue([req({ dueAt: new Date(NIGHT.getTime() - 60_000) })]);
    const r = await runReviewRequestsSweep(NIGHT);
    expect(r.deferred).toBe(1);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.prisma.reviewRequest.updateMany).not.toHaveBeenCalled();
  });

  it('skips when feedback already exists, the flow is disabled, or the ask went stale', async () => {
    queue([req({ order: { ...req().order, feedback: { id: 'f1' } } })]);
    await runReviewRequestsSweep(NOON);
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].data.error).toBe('feedback_exists');

    vi.clearAllMocks();
    queue([req()]);
    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfgRow({ enabled: false }));
    await runReviewRequestsSweep(NOON);
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].data.error).toBe('disabled');

    vi.clearAllMocks();
    queue([req({ dueAt: new Date(NOON.getTime() - 4 * 86_400_000) })]);
    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfgRow());
    await runReviewRequestsSweep(NOON);
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].data.error).toBe('stale');
    expect(h.sms).not.toHaveBeenCalled();
  });

  it('falls back from WhatsApp (no approved template) to the next channel', async () => {
    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfgRow({ channels: ['WHATSAPP', 'EMAIL'] }));
    queue([req()]);
    await runReviewRequestsSweep(NOON);
    expect(h.email).toHaveBeenCalledTimes(1);
    expect(h.prisma.reviewRequest.updateMany.mock.calls[0][0].data.channel).toBe('EMAIL');
  });

  it('marks FAILED (no retry spam) when the provider rejects', async () => {
    queue([req()]);
    h.sms.mockResolvedValue({ ok: false, error: 'DLT rejected' });
    const r = await runReviewRequestsSweep(NOON);
    expect(r.failed).toBe(1);
    expect(h.prisma.reviewRequest.update).toHaveBeenCalledWith({ where: { id: 'rr1' }, data: { status: 'FAILED', error: 'DLT rejected', reminderDueAt: null } });
  });
});

describe('runReviewRequestsSweep — reminders', () => {
  const sent = () => req({ status: 'SENT', reminderDueAt: new Date(NOON.getTime() - 60_000), reminderAt: null });

  it('sends exactly one reminder via an atomic claim on reminderAt', async () => {
    queue([], [sent()]);
    const r = await runReviewRequestsSweep(NOON);
    expect(r.reminders).toBe(1);
    expect(h.prisma.reviewRequest.updateMany).toHaveBeenCalledWith({ where: { id: 'rr1', status: 'SENT', reminderAt: null }, data: { reminderAt: NOON } });
    expect(h.sms.mock.calls[0][0].body).toMatch(/reminder/i);
    // only un-clicked (status SENT) rows are queried
    expect(h.prisma.reviewRequest.findMany.mock.calls[1][0].where).toMatchObject({ status: 'SENT', reminderAt: null });
  });

  it('does not remind after opt-out, and a lost claim sends nothing', async () => {
    queue([], [sent()]);
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue({ id: 'x' });
    await runReviewRequestsSweep(NOON);
    expect(h.sms).not.toHaveBeenCalled();

    vi.clearAllMocks();
    h.prisma.reviewRequestOptOut.findFirst.mockResolvedValue(null);
    h.prisma.reviewRequest.updateMany.mockResolvedValue({ count: 0 });
    queue([], [sent()]);
    await runReviewRequestsSweep(NOON);
    expect(h.sms).not.toHaveBeenCalled();
  });
});
