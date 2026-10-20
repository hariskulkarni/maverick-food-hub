/**
 * TOTP clock-skew tolerance: codes from the previous/next 30s step must verify
 * (window = 1) but nothing wider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticator } from 'otplib';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { verifyTotpSecret } from '@/server/user-totp';
import { verifyTotp } from '@/server/2fa';

const SECRET = 'JBSWY3DPEHPK3PXP';
const T0 = Date.UTC(2026, 0, 1, 12, 0, 15); // mid-step
const STEP = 30_000;

function tokenAt(ms: number): string {
  vi.setSystemTime(ms);
  const t = authenticator.generate(SECRET);
  vi.setSystemTime(T0);
  return t;
}

describe('TOTP window', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  it('exposes window = 1 exactly', () => {
    expect(authenticator.options.window).toBe(1);
  });

  for (const [name, fn] of [
    ['user-totp verifyTotpSecret', verifyTotpSecret],
    ['2fa verifyTotp', verifyTotp],
  ] as const) {
    describe(name, () => {
      it('accepts the current step', () => {
        expect(fn(SECRET, tokenAt(T0))).toBe(true);
      });
      it('accepts step-1 and step+1', () => {
        expect(fn(SECRET, tokenAt(T0 - STEP))).toBe(true);
        expect(fn(SECRET, tokenAt(T0 + STEP))).toBe(true);
      });
      it('rejects step-2 and step+2', () => {
        expect(fn(SECRET, tokenAt(T0 - 2 * STEP))).toBe(false);
        expect(fn(SECRET, tokenAt(T0 + 2 * STEP))).toBe(false);
      });
    });
  }
});
