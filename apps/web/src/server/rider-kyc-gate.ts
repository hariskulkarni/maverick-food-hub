/**
 * KYC gate for rider work (P1-14).
 *
 * A rider may go online / claim / be assigned orders only when every REQUIRED
 * document type is APPROVED and not past its expiry date (+ a short grace
 * window so a licence renewed on the last day doesn't strand the rider while
 * review catches up). Controlled by the platform setting `riderKycGate`
 * (default ON — toggle via PATCH /api/platform/rider-settings).
 *
 * Required: Aadhaar (identity), driving licence, vehicle RC, vehicle
 * insurance. PAN is optional (only needed for TDS at payout time).
 */
import type { KycDocumentStatus, KycDocumentType } from '@prisma/client';
import { prisma } from './db';
import { getRiderKycGate } from './platform-settings';

export const REQUIRED_KYC_TYPES: KycDocumentType[] = ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_RC', 'VEHICLE_INSURANCE'];

/** Days after `expiresOn` that an APPROVED document still counts (grace). */
export const KYC_EXPIRY_GRACE_DAYS = 3;

const LABELS: Record<KycDocumentType, string> = {
  AADHAAR: 'Aadhaar card',
  DRIVING_LICENSE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  PAN_CARD: 'PAN card',
};

export function kycTypeLabel(type: KycDocumentType): string {
  return LABELS[type] ?? type;
}

export interface KycGateResult {
  enforced: boolean;
  canGoOnline: boolean;
  blockingTypes: KycDocumentType[];
  message: string | null;
}

type GateDoc = { type: KycDocumentType; status: KycDocumentStatus; expiresOn: Date | null };

/** Pure evaluation — exported for tests. */
export function evaluateKycGate(docs: GateDoc[], enforced: boolean, now: Date = new Date()): KycGateResult {
  const graceMs = KYC_EXPIRY_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const byType = new Map(docs.map((d) => [d.type, d]));
  const blockingTypes = REQUIRED_KYC_TYPES.filter((t) => {
    const d = byType.get(t);
    if (!d || d.status !== 'APPROVED') return true;
    if (d.expiresOn && d.expiresOn.getTime() + graceMs < now.getTime()) return true;
    return false;
  });
  if (!enforced) return { enforced, canGoOnline: true, blockingTypes, message: null };
  const ok = blockingTypes.length === 0;
  return {
    enforced,
    canGoOnline: ok,
    blockingTypes,
    message: ok
      ? null
      : `Your KYC is incomplete: ${blockingTypes.map(kycTypeLabel).join(', ')} must be uploaded and approved before you can go online.`,
  };
}

export async function riderKycGate(riderId: string, now: Date = new Date()): Promise<KycGateResult> {
  const [enforced, docs] = await Promise.all([
    getRiderKycGate(),
    prisma.riderKycDocument.findMany({ where: { riderId }, select: { type: true, status: true, expiresOn: true } }),
  ]);
  return evaluateKycGate(docs, enforced, now);
}
