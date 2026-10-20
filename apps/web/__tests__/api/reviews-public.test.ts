import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    restaurant: { findUnique: vi.fn() },
    orderFeedback: { findMany: vi.fn(), aggregate: vi.fn() },
    googleReview: { findMany: vi.fn(), aggregate: vi.fn() },
  },
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/auth', () => ({ auth: async () => h.session }));

import { GET as publicGET } from '@/app/api/storefront/[slug]/reviews/route';
import { GET as mineGET } from '@/app/api/customer/reviews/route';

const fb = (o: Record<string, unknown>) => ({
  id: 'f1', orderId: 'o1', customerId: 'u1', foodRating: 4, deliveryRating: 2, overallRating: 5,
  comment: 'Great biryani', issueTags: ['LATE_DELIVERY'], imageUrl: 'http://img/x.jpg',
  shareCommentWithRider: true, windowEndsAt: new Date(Date.now() + 3600_000),
  createdAt: new Date('2026-10-10T10:00:00Z'), editedAt: null,
  moderationStatus: 'PUBLISHED', flagReason: 'secret', reply: null, replyAt: null,
  customer: { name: 'Priya Sharma', phone: '+919999999999', email: 'p@x.com' },
  ...o,
});
const pubCall = (qs = '') =>
  publicGET(new Request(`http://x/api/storefront/biryani/reviews${qs}`) as never, { params: Promise.resolve({ slug: 'biryani' }) });

beforeEach(() => {
  vi.resetAllMocks();
  h.session = null;
  h.prisma.restaurant.findUnique.mockResolvedValue({ id: 'r1' });
  h.prisma.orderFeedback.aggregate.mockResolvedValue({ _avg: { overallRating: 4.5 }, _count: { _all: 2 } });
  h.prisma.googleReview.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
  h.prisma.googleReview.findMany.mockResolvedValue([]);
});

describe('GET /api/storefront/[slug]/reviews', () => {
  it('404s unknown restaurant', async () => {
    h.prisma.restaurant.findUnique.mockResolvedValue(null);
    expect((await pubCall()).status).toBe(404);
  });

  it('queries PUBLISHED only and drops HIDDEN/FLAGGED defensively', async () => {
    h.prisma.orderFeedback.findMany.mockResolvedValue([
      fb({ id: 'a' }), fb({ id: 'b', moderationStatus: 'HIDDEN' }), fb({ id: 'c', moderationStatus: 'FLAGGED' }),
    ]);
    const j = await (await pubCall()).json();
    expect(h.prisma.orderFeedback.findMany.mock.calls[0][0].where.moderationStatus).toBe('PUBLISHED');
    expect(h.prisma.orderFeedback.aggregate.mock.calls[0][0].where.moderationStatus).toBe('PUBLISHED');
    expect(j.reviews.map((r: any) => r.id)).toEqual(['app:a']);
  });

  it('shows comment only when customer opted in', async () => {
    h.prisma.orderFeedback.findMany.mockResolvedValue([
      fb({ id: 'a', shareCommentWithRider: true }), fb({ id: 'b', shareCommentWithRider: false }),
    ]);
    const j = await (await pubCall()).json();
    expect(j.reviews.find((r: any) => r.id === 'app:a').comment).toBe('Great biryani');
    expect(j.reviews.find((r: any) => r.id === 'app:b').comment).toBeNull();
  });

  it('applies redaction: no PII, tags, image, delivery/food ratings, flag reason', async () => {
    h.prisma.orderFeedback.findMany.mockResolvedValue([fb({ reply: 'Thanks!', replyAt: new Date('2026-10-11T00:00:00Z') })]);
    const j = await (await pubCall()).json();
    const r = j.reviews[0];
    expect(r.author).toBe('Priya');
    expect(r.rating).toBe(5);
    expect(r.reply).toEqual({ text: 'Thanks!', at: '2026-10-11T00:00:00.000Z' });
    const s = JSON.stringify(j);
    for (const leak of ['Sharma', '9999', 'p@x.com', 'LATE_DELIVERY', 'img/x.jpg', 'secret', 'u1', 'o1', 'deliveryRating', 'foodRating'])
      expect(s).not.toContain(leak);
  });

  it('merges Google reviews newest-first, only POSTED replies, paginates', async () => {
    h.prisma.orderFeedback.findMany.mockResolvedValue([fb({ id: 'a', createdAt: new Date('2026-10-10T00:00:00Z') })]);
    h.prisma.googleReview.findMany.mockResolvedValue([
      { id: 'g1', reviewerName: 'Ravi Kumar', rating: 4, comment: 'Nice', reviewCreatedAt: new Date('2026-10-12T00:00:00Z'), reply: { state: 'POSTED', text: 'Thx', postedAt: new Date('2026-10-13T00:00:00Z') } },
      { id: 'g2', reviewerName: null, rating: 3, comment: 'ok', reviewCreatedAt: new Date('2026-10-01T00:00:00Z'), reply: { state: 'DRAFT', text: 'draft', postedAt: null } },
    ]);
    const j = await (await pubCall('?pageSize=2')).json();
    expect(j.reviews.map((r: any) => r.id)).toEqual(['google:g1', 'app:a']);
    expect(j.reviews[0].reply.text).toBe('Thx');
    expect(j.hasMore).toBe(true);
    expect(j.aggregate.count).toBe(3);
    const j2 = await (await pubCall('?pageSize=2&page=2')).json();
    expect(j2.reviews.map((r: any) => r.id)).toEqual(['google:g2']);
    expect(j2.reviews[0].reply).toBeNull();
    expect(j2.reviews[0].author).toBe('Google user');
  });
});

describe('GET /api/customer/reviews', () => {
  it('401 when signed out', async () => {
    expect((await mineGET()).status).toBe(401);
  });

  it('returns only own rows with full own data, reply and edit gate', async () => {
    h.session = { user: { id: 'u1', role: 'CUSTOMER' } };
    h.prisma.orderFeedback.findMany.mockResolvedValue([
      fb({ id: 'open', reply: 'Thanks', replyAt: new Date('2026-10-11T00:00:00Z'), order: { code: 'A1', branch: { restaurant: { name: 'Biryani Co', slug: 'biryani' } } } }),
      fb({ id: 'closed', windowEndsAt: new Date(Date.now() - 3600_000), order: { code: 'A2', branch: { restaurant: { name: 'Biryani Co', slug: 'biryani' } } } }),
    ]);
    const j = await (await mineGET()).json();
    expect(h.prisma.orderFeedback.findMany.mock.calls[0][0].where).toEqual({ customerId: 'u1' });
    const [a, b] = j.reviews;
    expect(a.deliveryRating).toBe(2);
    expect(a.comment).toBe('Great biryani');
    expect(a.issueTags).toEqual(['LATE_DELIVERY']);
    expect(a.reply).toEqual({ text: 'Thanks', at: '2026-10-11T00:00:00.000Z' });
    expect(a.canEdit).toBe(true);
    expect(b.canEdit).toBe(false);
    expect(JSON.stringify(j)).not.toContain('secret');
    expect(JSON.stringify(j)).not.toContain('moderationStatus');
  });
});
