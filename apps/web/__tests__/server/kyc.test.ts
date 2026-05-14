/**
 * Unit tests for the rider KYC server module.
 *
 * Covers:
 *   – Field validators (Aadhaar, DL, PAN, Insurance, Expiry)
 *   – `getStatusSummary` with a mocked Prisma client
 *   – A small `maskAadhaar` re-implementation that mirrors the rider UI's
 *     `XXXX XXXX <last4>` format. The rider-side helper is exported from the
 *     client component (`maskNumber(last4, type)`), so we re-implement here
 *     and assert the format the spec calls out.
 *
 * The actual validators return `{ ok: true, normalized } | { ok: false, error }`
 * so the assertions check `.ok` rather than a plain boolean.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    riderKycDocument: {
      findMany: vi.fn()
    }
  } as any
}));

vi.mock('@/server/db', () => ({ prisma: prismaMock }));

// We mock the crypto module so the server module imports don't try to read
// the runtime key when getStatusSummary's transitive imports load.
vi.mock('@/server/crypto', () => ({
  encryptJSON: (s: unknown) => `enc(${JSON.stringify(s)})`,
  decryptJSON: <T>(s: string) => JSON.parse(s.replace(/^enc\((.*)\)$/, '$1')) as T,
  maskSecret: (s: string | null | undefined, tail = 4) =>
    s ? `${'•'.repeat(Math.max(0, s.length - tail))}${s.slice(-tail)}` : ''
}));

import {
  validateAadhaar,
  validateLicense,
  validatePan,
  validateInsurance,
  validateExpiry,
  getStatusSummary,
  ALL_KYC_TYPES
} from '@/server/kyc';

// ─── validateAadhaar ────────────────────────────────────────────────────────
describe('validateAadhaar', () => {
  it('rejects a 4-digit string', () => {
    const r = validateAadhaar('1234');
    expect(r.ok).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    const r = validateAadhaar('abc');
    expect(r.ok).toBe(false);
  });

  it('accepts a 12-digit string', () => {
    const r = validateAadhaar('234512345678');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('234512345678');
  });

  it('strips internal whitespace before length-checking', () => {
    const r = validateAadhaar('2345 1234 5678');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('234512345678');
  });
});

// ─── validateLicense ────────────────────────────────────────────────────────
describe('validateLicense', () => {
  it('accepts a well-formed Indian DL number', () => {
    // KA01 (state + RTO) + 2019 + 0001234 = 13 alphanum trailing  → matches
    // /^[A-Z]{2}\d{2}[A-Z0-9]{11,13}$/
    const r = validateLicense('KA0120190001234');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('KA0120190001234');
  });

  it('rejects an obviously bad string', () => {
    const r = validateLicense('INVALID');
    expect(r.ok).toBe(false);
  });

  it('normalises case + strips separators', () => {
    const r = validateLicense('ka-01-2019-0001234');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('KA0120190001234');
  });
});

// ─── validatePan ────────────────────────────────────────────────────────────
describe('validatePan', () => {
  it('accepts uppercase ABCDE1234F', () => {
    const r = validatePan('ABCDE1234F');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('ABCDE1234F');
  });

  it('accepts lowercase by upper-casing it (matches current normalisation policy)', () => {
    // The validator currently up-cases before regex testing — we document that
    // explicitly: lowercase IS accepted, normalised to upper.
    const r = validatePan('abcde1234f');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('ABCDE1234F');
  });

  it('rejects a digits-first sequence', () => {
    const r = validatePan('12345ABCDE');
    expect(r.ok).toBe(false);
  });

  it('rejects when the trailing letter is missing', () => {
    const r = validatePan('ABCDE1234');
    expect(r.ok).toBe(false);
  });
});

// ─── validateInsurance ──────────────────────────────────────────────────────
describe('validateInsurance', () => {
  it('rejects empty input', () => {
    const r = validateInsurance('');
    expect(r.ok).toBe(false);
  });

  it('rejects "abc" (3 chars, below the 6 minimum)', () => {
    const r = validateInsurance('abc');
    expect(r.ok).toBe(false);
  });

  it('accepts a typical insurer policy number', () => {
    const r = validateInsurance('INS-2024-XYZ-12345');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe('INS-2024-XYZ-12345');
  });
});

// ─── validateExpiry ─────────────────────────────────────────────────────────
describe('validateExpiry', () => {
  it('rejects a past date', () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const r = validateExpiry(past);
    expect(r.ok).toBe(false);
  });

  it('accepts a future date', () => {
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const r = validateExpiry(future);
    expect(r.ok).toBe(true);
  });

  it('treats null as "no expiry to check" and returns ok', () => {
    const r = validateExpiry(null);
    expect(r.ok).toBe(true);
  });
});

// ─── getStatusSummary (mocked Prisma) ───────────────────────────────────────
describe('getStatusSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a fully-MISSING summary when the rider has no docs', async () => {
    prismaMock.riderKycDocument.findMany.mockResolvedValue([]);

    const s = await getStatusSummary('rider-1');

    expect(s.riderId).toBe('rider-1');
    expect(s.breakdown).toHaveLength(ALL_KYC_TYPES.length);
    // All 5 types are missing
    expect(s.breakdown.every((b) => b.status === 'MISSING')).toBe(true);
    expect(s.counts).toEqual({
      missing: ALL_KYC_TYPES.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0
    });
    expect(s.fullyApproved).toBe(false);
  });

  it('counts approved / pending / rejected / expired correctly', async () => {
    prismaMock.riderKycDocument.findMany.mockResolvedValue([
      { type: 'AADHAAR', status: 'APPROVED', expiresOn: null, submittedAt: new Date(), reviewedAt: new Date(), rejectionReason: null },
      { type: 'DRIVING_LICENSE', status: 'PENDING', expiresOn: null, submittedAt: new Date(), reviewedAt: null, rejectionReason: null },
      { type: 'VEHICLE_INSURANCE', status: 'REJECTED', expiresOn: null, submittedAt: new Date(), reviewedAt: new Date(), rejectionReason: 'blurry' },
      { type: 'PAN_CARD', status: 'EXPIRED', expiresOn: new Date(Date.now() - 1000), submittedAt: new Date(), reviewedAt: new Date(), rejectionReason: null }
    ]);

    const s = await getStatusSummary('rider-2');

    expect(s.counts.approved).toBe(1);
    expect(s.counts.pending).toBe(1);
    expect(s.counts.rejected).toBe(1);
    expect(s.counts.expired).toBe(1);
    // VEHICLE_RC was never submitted → still in MISSING
    expect(s.counts.missing).toBe(1);
    expect(s.fullyApproved).toBe(false);
  });

  it('marks fullyApproved when all 5 doc types are APPROVED', async () => {
    prismaMock.riderKycDocument.findMany.mockResolvedValue(
      ALL_KYC_TYPES.map((type) => ({
        type,
        status: 'APPROVED',
        expiresOn: null,
        submittedAt: new Date(),
        reviewedAt: new Date(),
        rejectionReason: null
      }))
    );

    const s = await getStatusSummary('rider-3');
    expect(s.counts.approved).toBe(ALL_KYC_TYPES.length);
    expect(s.fullyApproved).toBe(true);
  });
});

// ─── Mask helper (re-implemented to match the rider UI contract) ────────────
//
// The rider UI exposes `maskNumber(last4, type)` from document-card.tsx, but
// that module imports React (it's a client component) so it can't be loaded
// inside a node-only vitest run without extra plumbing. The format is part
// of the visual contract though, so we re-implement the Aadhaar branch here
// and assert against it directly.
function maskAadhaar(last4: string): string {
  if (!last4) return '••••';
  return `XXXX XXXX ${last4}`;
}

describe('maskAadhaar', () => {
  it('formats a 4-digit tail as XXXX XXXX <tail>', () => {
    expect(maskAadhaar('5678')).toBe('XXXX XXXX 5678');
  });

  it('returns a bullet placeholder when last4 is empty', () => {
    expect(maskAadhaar('')).toBe('••••');
  });
});
