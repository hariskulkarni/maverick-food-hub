import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn().mockResolvedValue(null),
  sweep: vi.fn().mockResolvedValue({ restaurantsScanned: 0 }),
}));

vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/jobs/google-reviews-sweep', () => ({ runGoogleReviewsSweep: h.sweep }));

import { POST } from '@/app/api/platform/jobs/google-reviews/run/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_CRON_SECRET = 's3cret';
  h.auth.mockResolvedValue(null);
  h.sweep.mockResolvedValue({ restaurantsScanned: 0 });
});

describe('POST /api/platform/jobs/google-reviews/run', () => {
  it('403 without secret or session, and does not run the sweep', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }) as any);
    expect(res.status).toBe(403);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('403 with a wrong internal secret', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 'nope' } }) as any,
    );
    expect(res.status).toBe(403);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('403 when INTERNAL_CRON_SECRET is unset and the header is empty', async () => {
    delete process.env.INTERNAL_CRON_SECRET;
    h.auth.mockResolvedValue(null);
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': '' } }) as any,
    );
    expect(res.status).toBe(403);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('runs the sweep when x-internal-secret matches', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }) as any,
    );
    expect(res.status).toBe(200);
    expect(h.sweep).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.restaurantsScanned).toBe(0);
    expect(typeof body.at).toBe('string');
  });
});
