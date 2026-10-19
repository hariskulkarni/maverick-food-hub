/**
 * C10 — client IP must come from a header the client cannot forge: the LAST
 * X-Forwarded-For hop (nginx's appended peer), or CF-Connecting-IP / X-Real-IP.
 * Never the left-most, client-supplied XFF element.
 */
import { describe, it, expect } from 'vitest';
import { clientIp } from '@/server/http/client-ip';
import { clientIp as rlClientIp } from '@/server/http/rate-limit';

const hdr = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null
});

describe('C10: client-ip resolution', () => {
  it('returns the LAST XFF hop, not the client-supplied first', () => {
    expect(clientIp(hdr({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('prefers CF-Connecting-IP over everything', () => {
    expect(
      clientIp(hdr({ 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '1.2.3.4, 9.9.9.9', 'x-real-ip': '8.8.8.8' }))
    ).toBe('5.5.5.5');
  });

  it('falls back to X-Real-IP when no CF header', () => {
    expect(clientIp(hdr({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }))).toBe('8.8.8.8');
  });

  it('returns null when nothing resolves', () => {
    expect(clientIp(hdr({}))).toBeNull();
  });

  it('rate-limit clientIp delegates to the shared helper (last hop)', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } });
    expect(rlClientIp(req)).toBe('9.9.9.9');
  });
});
