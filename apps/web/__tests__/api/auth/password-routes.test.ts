import { describe, it, expect, vi, beforeEach } from 'vitest';

const { request, consume, rl } = vi.hoisted(() => ({
  request: vi.fn(async () => {}),
  consume: vi.fn(),
  rl: vi.fn(async () => ({ ok: true, remaining: 1 })),
}));
vi.mock('@/server/auth/password-reset', () => ({ requestPasswordReset: request, consumePasswordReset: consume }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: rl, clientIp: () => '5.6.7.8' }));

import { POST as reqPOST } from '@/app/api/auth/password/request/route';
import { POST as resetPOST } from '@/app/api/auth/password/reset/route';

const mk = (url: string, body: unknown) =>
  new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => { vi.clearAllMocks(); rl.mockResolvedValue({ ok: true, remaining: 1 }); });

describe('POST /api/auth/password/request', () => {
  it('always 200 {ok:true}, even when the service has nothing to do', async () => {
    const res = await reqPOST(mk('/api/auth/password/request', { email: 'nobody@x.com' }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith('nobody@x.com', '5.6.7.8');
    expect(rl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'pw-reset-req', limit: 5, windowMs: 900_000 }));
  });
  it('still 200 on malformed body / service error', async () => {
    request.mockRejectedValueOnce(new Error('db'));
    const res = await reqPOST(mk('/api/auth/password/request', { email: 'a@x.com' }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const bad = await reqPOST(new Request('http://x/', { method: 'POST', body: 'zzz' }) as any);
    expect(bad.status).toBe(200);
  });
  it('rate limited -> 429', async () => {
    rl.mockResolvedValueOnce({ ok: false, response: Response.json({}, { status: 429 }) } as any);
    const res = await reqPOST(mk('/x', { email: 'a@x.com' }) as any);
    expect(res.status).toBe(429);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/password/reset', () => {
  it('200 with staffReenroll on success; token not echoed', async () => {
    consume.mockResolvedValue({ ok: true, staffReenroll: true });
    const res = await resetPOST(mk('/r', { token: 'SECRETTOKEN', password: 'long-enough-pw' }) as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, staffReenroll: true });
    expect(text).not.toContain('SECRETTOKEN');
    expect(rl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'pw-reset-do', limit: 10, windowMs: 900_000 }));
  });
  it('400 with reason on failure', async () => {
    consume.mockResolvedValue({ ok: false, reason: 'expired' });
    const res = await resetPOST(mk('/r', { token: 't', password: 'long-enough-pw' }) as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'expired' });
  });
  it('400 invalid on missing fields', async () => {
    const res = await resetPOST(mk('/r', {}) as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid' });
  });
});
