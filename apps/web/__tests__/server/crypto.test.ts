import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Provide a stable NEXTAUTH_SECRET so resolveKey() has a deterministic fallback.
const ORIGINAL_KEY = process.env.INTEGRATION_ENCRYPTION_KEY;
const ORIGINAL_SEED = process.env.NEXTAUTH_SECRET;

beforeAll(() => {
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.NEXTAUTH_SECRET = 'test-seed-for-crypto-tests';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = ORIGINAL_KEY;
  if (ORIGINAL_SEED === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = ORIGINAL_SEED;
});

import { encryptJSON, decryptJSON, maskSecret } from '@/server/crypto';

describe('crypto — round trip', () => {
  it('encryptJSON → decryptJSON preserves a simple object', () => {
    const blob = encryptJSON({ a: 1 });
    expect(typeof blob).toBe('string');
    const back = decryptJSON<{ a: number }>(blob);
    expect(back).toEqual({ a: 1 });
  });

  it('round-trips strings, numbers and nested objects', () => {
    const original = { token: 'abc-123', expires: 1234567890, nested: { ok: true, list: [1, 2, 3] } };
    const blob = encryptJSON(original);
    expect(decryptJSON(blob)).toEqual(original);
  });

  it('produces different ciphertexts for the same plaintext (IV randomization)', () => {
    const a = encryptJSON({ a: 1 });
    const b = encryptJSON({ a: 1 });
    expect(a).not.toBe(b);
  });
});

describe('crypto — tamper detection', () => {
  it('throws when ciphertext is tampered with', () => {
    const blob = encryptJSON({ a: 1 });
    const buf = Buffer.from(blob, 'base64');
    // Flip the last byte of the ciphertext — the GCM auth tag check should fail.
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => decryptJSON(tampered)).toThrow();
  });

  it('throws on too-short ciphertext', () => {
    expect(() => decryptJSON('AAA=')).toThrow();
  });
});

describe('crypto — maskSecret', () => {
  it('shows the last 4 characters and bullets the rest', () => {
    const masked = maskSecret('rzp_live_abc1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).not.toContain('rzp_live_abc');
    // Everything before the tail should be bullets
    const head = masked.slice(0, -4);
    expect(head).toMatch(/^•+$/);
  });

  it('handles empty / null / undefined safely', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
    expect(maskSecret(undefined)).toBe('');
  });

  it('bullets the entire string when it is shorter than `tail`', () => {
    expect(maskSecret('abc')).toBe('•••');
  });
});
