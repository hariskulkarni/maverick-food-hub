import { describe, it, expect } from 'vitest';
import { redactText, normalizeForFingerprint, stackSignature } from '@/server/observability/redact';

describe('redactText', () => {
  it('removes bearer tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactText(`auth failed: Authorization: Bearer abcdef1234567890xyz token ${jwt}`);
    expect(out).not.toContain('abcdef1234567890xyz');
    expect(out).not.toContain(jwt);
    expect(out).toContain('[JWT]');
  });
  it('removes key=value secrets incl. the cron secret header', () => {
    const out = redactText('password=hunter2 api_key: "sk_live_abc" x-internal-secret=s3cr3t otp=123456');
    for (const s of ['hunter2', 'sk_live_abc', 's3cr3t', '123456']) expect(out).not.toContain(s);
  });
  it('removes e-mails, Indian phone numbers and OTP codes in prose', () => {
    const out = redactText('Sent to ravi.k@example.com / +91 9876543210 / 9123456780 — your code is 482913');
    expect(out).not.toMatch(/ravi\.k@example\.com/);
    expect(out).not.toContain('9876543210');
    expect(out).not.toContain('9123456780');
    expect(out).not.toContain('482913');
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
  });
  it('removes card-like numbers and long hex tokens, credentials in URLs', () => {
    const out = redactText('card 4111 1111 1111 1111 key a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2 postgres://u:pw@db/x');
    expect(out).not.toContain('4111 1111');
    expect(out).not.toContain('a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2');
    expect(out).not.toContain('u:pw@');
  });
  it('keeps ordinary error text readable and truncates', () => {
    expect(redactText('Cannot read properties of undefined (reading "id")')).toBe('Cannot read properties of undefined (reading "id")');
    expect(redactText('x'.repeat(5000), 100).length).toBeLessThanOrEqual(101);
    expect(redactText(null)).toBe('');
  });
});

describe('fingerprint normalisation', () => {
  it('collapses ids and numbers so repeats group together', () => {
    const a = normalizeForFingerprint('Order cm1abcdefghijklmnopqrstu not found after 3 tries');
    const b = normalizeForFingerprint('Order cm9zyxwvutsrqponmlkjihgf not found after 7 tries');
    expect(a).toBe(b);
  });
  it('stack signature ignores line numbers, paths and node_modules frames', () => {
    const s1 = 'Error: x\n    at handler (/app/.next/server/chunks/123.js:10:5)\n    at node_modules/next/dist/x.js:1:1\n    at run (/app/src/a.ts:20:7)';
    const s2 = 'Error: x\n    at handler (/srv/.next/server/chunks/123.js:99:1)\n    at run (/srv/src/a.ts:21:9)';
    expect(stackSignature(s1)).toBe(stackSignature(s2));
    expect(stackSignature(s1)).toContain('handler');
    expect(stackSignature(null)).toBe('');
  });
});
