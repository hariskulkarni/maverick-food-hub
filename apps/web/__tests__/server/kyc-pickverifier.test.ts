/**
 * C13 — pickVerifier() must never fall back to the random mock verifier in
 * production (KYC_VERIFIER unset or 'mock').
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: { $queryRawUnsafe: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/server/crypto', () => ({
  encryptJSON: (s: unknown) => JSON.stringify(s),
  decryptJSON: (s: string) => JSON.parse(s),
  maskSecret: () => ''
}));

import { pickVerifier } from '@/server/kyc-verifiers';

afterEach(() => vi.unstubAllEnvs());

describe('C13: pickVerifier production guard', () => {
  it('throws in production when KYC_VERIFIER is unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KYC_VERIFIER', '');
    vi.stubEnv('DEMO_MODE', '');
    expect(() => pickVerifier()).toThrow(/mock verifier/i);
  });

  it("throws in production when KYC_VERIFIER='mock'", () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KYC_VERIFIER', 'mock');
    vi.stubEnv('DEMO_MODE', '');
    expect(() => pickVerifier()).toThrow();
  });

  it('returns the mock in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('KYC_VERIFIER', '');
    expect(pickVerifier().name).toBe('mock');
  });

  it('returns the mock in production only with DEMO_MODE=true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('KYC_VERIFIER', '');
    expect(pickVerifier().name).toBe('mock');
  });

  it('honours an explicit real driver', () => {
    vi.stubEnv('KYC_VERIFIER', 'karza');
    expect(pickVerifier().name).toBe('karza');
  });
});
