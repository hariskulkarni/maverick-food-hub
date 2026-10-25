/**
 * F14/C10: per-IP OTP caps and audit IPs key on the trusted client IP (the
 * last X-Forwarded-For hop / X-Real-IP), never the client-supplied first hop.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sendOtp = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/server/otp', () => ({ sendOtp, OtpRateLimitedError: class extends Error {} }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));

import { POST } from '@/app/api/auth/otp/route';

describe('client IP', () => {
  it('OTP send passes the last XFF hop, not the spoofable first one', async () => {
    await POST(new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6, 9.9.9.9' },
      body: JSON.stringify({ phone: '+919876500001' }),
    }) as any);
    expect(sendOtp).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: '9.9.9.9' }));
  });
  it('no /api/platform audit uses the first XFF hop (rider-payouts excepted: rider stream)', () => {
    const root = path.resolve(__dirname, '../../src/app/api/platform');
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (fs.readFileSync(p, 'utf8').includes("get('x-forwarded-for')?.split(',')[0]") && !p.includes('rider-payouts')) bad.push(p);
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });
});
