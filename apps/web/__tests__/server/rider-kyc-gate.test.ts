/** P1-14 — KYC gate: required docs approved and in date (+grace). */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/platform-settings', () => ({ getRiderKycGate: async () => true }));
import { evaluateKycGate, REQUIRED_KYC_TYPES, KYC_EXPIRY_GRACE_DAYS } from '@/server/rider-kyc-gate';

const now = new Date('2026-10-25T06:00:00Z');
const day = 86400_000;
const approvedAll = (expiresOn: Date | null = new Date(now.getTime() + 100 * day)) =>
  REQUIRED_KYC_TYPES.map((type) => ({ type, status: 'APPROVED' as const, expiresOn }));

describe('evaluateKycGate', () => {
  it('passes when every required doc is approved and in date (PAN optional)', () => {
    expect(evaluateKycGate(approvedAll(), true, now)).toMatchObject({ canGoOnline: true, blockingTypes: [] });
  });
  it('blocks on missing, pending, rejected or expired docs and names them', () => {
    const docs = approvedAll().filter((d) => d.type !== 'AADHAAR');
    docs[0] = { ...docs[0], status: 'PENDING' as any };
    const r = evaluateKycGate(docs, true, now);
    expect(r.canGoOnline).toBe(false);
    expect(r.blockingTypes).toEqual(expect.arrayContaining(['AADHAAR', docs[0].type]));
    expect(r.message).toMatch(/Aadhaar card/);
    expect(evaluateKycGate(approvedAll().map((d) => ({ ...d, status: 'EXPIRED' as any })), true, now).canGoOnline).toBe(false);
  });
  it(`honours a ${KYC_EXPIRY_GRACE_DAYS}-day grace after expiresOn`, () => {
    expect(evaluateKycGate(approvedAll(new Date(now.getTime() - 2 * day)), true, now).canGoOnline).toBe(true);
    expect(evaluateKycGate(approvedAll(new Date(now.getTime() - 4 * day)), true, now).canGoOnline).toBe(false);
  });
  it('never blocks when the platform setting is off', () => {
    expect(evaluateKycGate([], false, now)).toMatchObject({ enforced: false, canGoOnline: true });
  });
});
