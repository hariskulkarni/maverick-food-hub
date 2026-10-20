import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn().mockResolvedValue(null),
  sweep: vi.fn().mockResolvedValue({ scanned: 0 }),
}));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/jobs/youpi-reconcile-sweep', () => ({ runYoupiReconcileSweep: h.sweep }));

import { POST } from '@/app/api/platform/jobs/youpi-reconcile/run/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_CRON_SECRET = 's3cret';
  h.auth.mockResolvedValue(null);
  h.sweep.mockResolvedValue({ scanned: 0 });
});

describe('POST /api/platform/jobs/youpi-reconcile/run', () => {
  it('403 without secret, sweep not run', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }) as any);
    expect(res.status).toBe(403);
    expect(h.sweep).not.toHaveBeenCalled();
  });
  it('200 and runs sweep with matching x-internal-secret', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }) as any,
    );
    expect(res.status).toBe(200);
    expect(h.sweep).toHaveBeenCalledTimes(1);
  });
});
