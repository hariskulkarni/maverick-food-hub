import { describe, it, expect } from 'vitest';
import { randomStringFromAlphabet } from '@/server/secure-random';
import { genShareToken } from '@/server/rider-safety';
import { newReferralRowCode } from '@/server/rider-growth';
import { generateTempPassword } from '@/server/platform-user-admin';

describe('randomStringFromAlphabet', () => {
  it('returns the requested length drawn only from the alphabet', () => {
    const s = randomStringFromAlphabet('ABC', 50);
    expect(s).toMatch(/^[ABC]{50}$/);
    expect(randomStringFromAlphabet('AB', 0)).toBe('');
  });

  it('rejects a degenerate alphabet', () => {
    expect(() => randomStringFromAlphabet('A', 4)).toThrow();
  });

  it('is not modulo-biased toward the first symbols (31-symbol alphabet)', () => {
    // With `byte % 31`, symbols 0..7 are drawn 9/256 vs 8/256 for the rest —
    // ~12.5% more often. Uniform sampling keeps both groups within noise.
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const counts = new Map<string, number>();
    const s = randomStringFromAlphabet(alphabet, 310_000);
    for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const head = [...alphabet.slice(0, 8)].reduce((a, c) => a + (counts.get(c) ?? 0), 0) / 8;
    const tail = [...alphabet.slice(8)].reduce((a, c) => a + (counts.get(c) ?? 0), 0) / 23;
    expect(head / tail).toBeLessThan(1.05);
    expect(head / tail).toBeGreaterThan(0.95);
  });
});

describe('callers keep their formats', () => {
  it('share token, referral row code, temp password', () => {
    expect(genShareToken()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/);
    expect(newReferralRowCode('RIDE-ABC123')).toMatch(/^RIDE-ABC123-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    expect(generateTempPassword()).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  });
});
