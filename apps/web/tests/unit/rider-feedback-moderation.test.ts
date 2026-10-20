import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { orderFeedback: { findMany: m.findMany } } }));

import { loadRiderFeedback } from '@/server/feedback';

const row = (id: string, deliveryRating: number, moderationStatus: string) => ({
  id, orderId: 'o' + id, customerId: 'c1', foodRating: 4, deliveryRating, overallRating: 4,
  comment: null, issueTags: [], imageUrl: null, shareCommentWithRider: false,
  windowEndsAt: new Date(), createdAt: new Date(), editedAt: null,
  moderationStatus, order: { code: 'X' + id }
});

beforeEach(() => {
  m.findMany.mockReset();
  const all = [row('1', 5, 'PUBLISHED'), row('2', 1, 'HIDDEN'), row('3', 1, 'FLAGGED')];
  m.findMany.mockImplementation(async (arg: any) =>
    all.filter((r) => !arg.where.moderationStatus || r.moderationStatus === arg.where.moderationStatus));
});

describe('loadRiderFeedback moderation parity', () => {
  it('queries PUBLISHED only', async () => {
    await loadRiderFeedback('r1');
    expect(m.findMany.mock.calls[0][0].where.moderationStatus).toBe('PUBLISHED');
  });

  it('excludes HIDDEN/FLAGGED rows and their ratings from avgDelivery', async () => {
    const { rows, summary } = await loadRiderFeedback('r1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('1');
    expect(summary.count).toBe(1);
    expect(summary.avgDelivery).toBe(5);
  });
});
