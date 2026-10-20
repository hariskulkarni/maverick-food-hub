import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  canAccess: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/db', () => ({ prisma: { order: { findUnique: h.findUnique } } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/server/tenancy', () => ({ userCanAccessRestaurant: h.canAccess }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));

import { GET } from '@/app/api/payments/youpi/status/route';

const call = () => GET(new Request('http://x/api/payments/youpi/status?orderId=o1') as any);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue({
    id: 'o1',
    code: 'ORD-1',
    customerId: 'cust1',
    branch: { restaurantId: 'r1' },
    status: 'PENDING',
    payments: [{ id: 'p1', status: 'CAPTURED', errorMessage: null }],
  });
  h.canAccess.mockResolvedValue(false);
});

describe('GET /api/payments/youpi/status tenant scoping', () => {
  it('non-owner CUSTOMER -> 403', async () => {
    h.auth.mockResolvedValue({ user: { id: 'other', role: 'CUSTOMER' } });
    expect((await call()).status).toBe(403);
    expect(h.canAccess).not.toHaveBeenCalled();
  });

  it('owning CUSTOMER -> 200', async () => {
    h.auth.mockResolvedValue({ user: { id: 'cust1', role: 'CUSTOMER' } });
    expect((await call()).status).toBe(200);
  });

  it('admin who does NOT manage the order restaurant -> 403', async () => {
    h.auth.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN' } });
    h.canAccess.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(h.canAccess).toHaveBeenCalledWith('adm1', 'r1');
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('admin who DOES manage it -> 200', async () => {
    h.auth.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN' } });
    h.canAccess.mockResolvedValue(true);
    expect((await call()).status).toBe(200);
  });

  it('SUPER_ADMIN -> 200 without membership check', async () => {
    h.auth.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    expect((await call()).status).toBe(200);
    expect(h.canAccess).not.toHaveBeenCalled();
  });
});
