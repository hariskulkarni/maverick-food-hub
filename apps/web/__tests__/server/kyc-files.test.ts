/** P1-14 — KYC files: signed short-lived links, private storage, PDFs keep their type. */
import { describe, it, expect, beforeEach } from 'vitest';
import { signedKycFileUrl, verifyKycFileSig, KYC_FILE_URL_TTL_SECONDS } from '@/server/kyc-files';
import { buildKey, isPrivateRef } from '@/server/storage';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'unit-test-secret-abcdef0123456789';
});

describe('signed KYC file links', () => {
  it('verify for the same doc until expiry, never for another doc or a forged sig', () => {
    const now = Date.now();
    const url = new URL(signedKycFileUrl('doc1', now), 'http://x');
    expect(url.pathname).toBe('/api/rider/kyc/doc1/file');
    const exp = url.searchParams.get('exp');
    const sig = url.searchParams.get('sig');
    expect(verifyKycFileSig('doc1', exp, sig, now)).toBe(true);
    expect(verifyKycFileSig('doc2', exp, sig, now)).toBe(false);
    expect(verifyKycFileSig('doc1', exp, sig + 'x', now)).toBe(false);
    expect(verifyKycFileSig('doc1', String(Number(exp) + 60), sig, now)).toBe(false);
    expect(verifyKycFileSig('doc1', exp, sig, now + (KYC_FILE_URL_TTL_SECONDS + 5) * 1000)).toBe(false);
    expect(verifyKycFileSig('doc1', null, null, now)).toBe(false);
  });
});

describe('storage', () => {
  it('keeps .pdf (no more forced .bin download) and still neuters html/svg', () => {
    expect(buildKey('licence.PDF', 'rider-kyc/r1/DRIVING_LICENSE')).toMatch(/\.pdf$/);
    expect(buildKey('x.html', 'a')).toMatch(/\.bin$/);
    expect(buildKey('x.svg', 'a')).toMatch(/\.bin$/);
  });
  it('private refs are recognisable', () => {
    expect(isPrivateRef('private:rider-kyc/a.pdf')).toBe(true);
    expect(isPrivateRef('/uploads/rider-kyc/a.pdf')).toBe(false);
  });
});
