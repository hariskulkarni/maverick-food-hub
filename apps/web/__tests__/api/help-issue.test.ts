import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    riderProfile: { findUnique: vi.fn() },
    restaurantUser: { findFirst: vi.fn() },
    order: { findUnique: vi.fn() },
    supportTicket: { create: vi.fn() }
  },
  auth: vi.fn()
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));

import { POST } from '@/app/api/support/tickets/route';
import { buildIssueTicket, submitIssue } from '@/lib/help-issue';

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ user: { id: 'u1', role: 'CUSTOMER' } });
  h.prisma.order.findUnique.mockResolvedValue({ branch: { restaurantId: 'r1' } });
  h.prisma.supportTicket.create.mockImplementation(async ({ data }: any) => ({ id: 't1', ...data }));
});

describe('buildIssueTicket', () => {
  it('maps category + description + order link to the ticket payload', () => {
    expect(buildIssueTicket({ category: 'WRONG_ITEM', description: ' Got a burger instead ', orderId: 'o1' })).toEqual({
      type: 'WRONG_ITEM',
      message: 'Got a burger instead',
      orderId: 'o1'
    });
  });
  it('omits blank order link', () => {
    expect(buildIssueTicket({ category: 'OTHER', description: 'help me', orderId: '  ' })).not.toHaveProperty('orderId');
  });
});

describe('submitIssue', () => {
  it('POSTs to the existing support tickets endpoint', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: { id: 't1' } }) });
    const r = await submitIssue({ category: 'PAYMENT_ISSUE', description: 'charged twice' }, f as never);
    expect(f).toHaveBeenCalledWith('/api/support/tickets', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ type: 'PAYMENT_ISSUE', message: 'charged twice' });
    expect(r).toEqual({ ok: true, ticketId: 't1' });
  });
  it('reports failure', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    expect(await submitIssue({ category: 'OTHER', description: 'abc' }, f as never)).toEqual({ ok: false });
  });
});

describe('issue submission creates a ticket', () => {
  it('persists a customer-linked SupportTicket tied to the order', async () => {
    const body = JSON.stringify(buildIssueTicket({ category: 'MISSING_ITEM', description: 'no fries', orderId: 'o1' }));
    const res = await POST(new Request('http://x/api', { method: 'POST', body }) as never);
    expect(res.status).toBe(200);
    expect(h.prisma.supportTicket.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', type: 'MISSING_ITEM', message: 'no fries', customerId: 'u1', riderId: undefined, restaurantId: 'r1' }
    });
  });
  it('rejects unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    const res = await POST(new Request('http://x/api', { method: 'POST', body: '{}' }) as never);
    expect(res.status).toBe(401);
    expect(h.prisma.supportTicket.create).not.toHaveBeenCalled();
  });
});
