/**
 * Rider KYC server module.
 *
 * Document number lifecycle:
 *   - raw plaintext is accepted only in this module (`encryptDocNumber`)
 *   - stored as AES-256-GCM base64 ciphertext in `RiderKycDocument.numberEncrypted`
 *   - last 4 chars cached in `numberLast4` for masked UI display
 *   - NEVER returned in plaintext from any API; super-admin only sees the mask
 *
 * Status transitions (enforced in callers / `assertTransition`):
 *   PENDING  → APPROVED | REJECTED
 *   *        → EXPIRED   (via expiry sweep)
 *   REJECTED → PENDING   (rider re-uploads)
 *
 * Validation regexes are India-specific (Aadhaar, RTO licence format, PAN, RC).
 */
import { KycDocumentStatus, KycDocumentType } from '@prisma/client';
import { prisma } from './db';
import { encryptJSON, decryptJSON, maskSecret } from './crypto';
import { runLiveVerification } from './kyc-verifiers';
import type { VerifyInput } from './kyc-verifiers/types';
import { audit } from './audit';

// ─── Validators ─────────────────────────────────────────────────────────────

/** 12 digits. Verhoeff checksum optional; we enforce shape only. */
export function validateAadhaar(num: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const n = num.replace(/\s+/g, '');
  if (!/^\d{12}$/.test(n)) return { ok: false, error: 'Aadhaar must be exactly 12 digits.' };
  return { ok: true, normalized: n };
}

/** Indian DL: e.g. MH1420110012345 — 2 state letters + 2-digit RTO + 11-13 alphanum. */
export function validateLicense(num: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const n = num.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,13}$/.test(n)) {
    return { ok: false, error: 'Driving licence format invalid (expected e.g. MH1420110012345).' };
  }
  return { ok: true, normalized: n };
}

/** Insurance policy number — free-form, 6-40 chars, alphanumeric + dash/slash. */
export function validateInsurance(num: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const n = num.trim().toUpperCase();
  if (!/^[A-Z0-9/\-]{6,40}$/.test(n)) {
    return { ok: false, error: 'Insurance policy number must be 6-40 alphanumeric characters.' };
  }
  return { ok: true, normalized: n };
}

/** PAN: 5 letters + 4 digits + 1 letter. */
export function validatePan(num: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const n = num.trim().toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(n)) {
    return { ok: false, error: 'PAN must be 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F).' };
  }
  return { ok: true, normalized: n };
}

/** RC: e.g. MH12AB1234 or KA01AA1. */
export function validateRc(num: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const n = num.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(n)) {
    return { ok: false, error: 'Vehicle RC number format invalid (expected e.g. MH12AB1234).' };
  }
  return { ok: true, normalized: n };
}

/** expiresOn must be strictly in the future (today 00:00 cutoff). */
export function validateExpiry(d: Date | null | undefined): { ok: true } | { ok: false; error: string } {
  if (!d) return { ok: true };
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return { ok: false, error: 'Invalid expiry date.' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t < today.getTime()) return { ok: false, error: 'Expiry date is already in the past.' };
  return { ok: true };
}

/** Run the correct validator for the document type. */
export function validateForType(
  type: KycDocumentType,
  rawNumber: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  switch (type) {
    case 'AADHAAR':          return validateAadhaar(rawNumber);
    case 'DRIVING_LICENSE':  return validateLicense(rawNumber);
    case 'VEHICLE_INSURANCE':return validateInsurance(rawNumber);
    case 'PAN_CARD':         return validatePan(rawNumber);
    case 'VEHICLE_RC':       return validateRc(rawNumber);
    default:
      return { ok: false, error: `Unknown document type: ${String(type)}` };
  }
}

// ─── Crypto helpers ─────────────────────────────────────────────────────────

/** Encrypt a normalized document number and return the storable parts. */
export function encryptDocNumber(normalized: string): { numberEncrypted: string; numberLast4: string } {
  return {
    numberEncrypted: encryptJSON(normalized),
    numberLast4: normalized.slice(-4)
  };
}

/**
 * Decrypt a number — server-only. Do NOT expose the return value via any API.
 * Intended for offline re-validation jobs or super-admin investigation tooling.
 */
export function decryptDocNumber(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    return decryptJSON<string>(blob);
  } catch {
    return null;
  }
}

// ─── Status / summary ───────────────────────────────────────────────────────

export const ALL_KYC_TYPES: KycDocumentType[] = [
  'AADHAAR',
  'DRIVING_LICENSE',
  'VEHICLE_INSURANCE',
  'VEHICLE_RC',
  'PAN_CARD'
];

/** UI-safe snapshot of a single document — never includes plaintext numbers. */
export function toPublicDoc(doc: {
  id: string;
  type: KycDocumentType;
  status: KycDocumentStatus;
  numberLast4: string | null;
  fileUrl: string;
  fileName: string | null;
  fileSize: number | null;
  fileMimeType: string | null;
  issuedOn: Date | null;
  expiresOn: Date | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    numberMasked: maskSecret(doc.numberLast4 ?? '', 4),
    numberLast4: doc.numberLast4,
    fileUrl: doc.fileUrl,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    fileMimeType: doc.fileMimeType,
    issuedOn: doc.issuedOn,
    expiresOn: doc.expiresOn,
    submittedAt: doc.submittedAt,
    reviewedAt: doc.reviewedAt,
    reviewedBy: doc.reviewedBy,
    rejectionReason: doc.rejectionReason,
    updatedAt: doc.updatedAt
  };
}

/**
 * Per-rider KYC status summary: which doc types are missing, pending, approved,
 * rejected or expired. The dashboard / rider home screen consumes this to nudge
 * the rider toward completion.
 */
export async function getStatusSummary(riderId: string) {
  const docs = await prisma.riderKycDocument.findMany({
    where: { riderId },
    select: {
      type: true,
      status: true,
      expiresOn: true,
      submittedAt: true,
      reviewedAt: true,
      rejectionReason: true
    }
  });
  const byType = new Map(docs.map((d) => [d.type, d]));

  const breakdown = ALL_KYC_TYPES.map((type) => {
    const d = byType.get(type);
    if (!d) {
      return { type, status: 'MISSING' as const, expiresOn: null, rejectionReason: null };
    }
    return {
      type,
      status: d.status,
      expiresOn: d.expiresOn,
      rejectionReason: d.rejectionReason
    };
  });

  const counts = {
    missing:  breakdown.filter((b) => b.status === 'MISSING').length,
    pending:  docs.filter((d) => d.status === 'PENDING').length,
    approved: docs.filter((d) => d.status === 'APPROVED').length,
    rejected: docs.filter((d) => d.status === 'REJECTED').length,
    expired:  docs.filter((d) => d.status === 'EXPIRED').length
  };

  const fullyApproved =
    counts.approved === ALL_KYC_TYPES.length &&
    counts.pending === 0 &&
    counts.rejected === 0 &&
    counts.expired === 0;

  return { riderId, breakdown, counts, fullyApproved };
}

/** Status transition guard. Throws a 4xx-style Response on violation. */
export function assertTransition(from: KycDocumentStatus, to: KycDocumentStatus): void {
  if (from === to) return;
  if (to === 'EXPIRED') return; // any → EXPIRED (sweep)
  if (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED')) return;
  if (from === 'REJECTED' && to === 'PENDING') return; // re-upload
  throw new Response(`Invalid KYC status transition: ${from} → ${to}`, { status: 409 });
}

// ─── Live verification ──────────────────────────────────────────────────────

/**
 * Run the configured live verifier against an authoritative source (Karza /
 * Surepass / mock) and persist the outcome onto the RiderKycDocument row.
 *
 * PAN and Driving License auto-approve on a verifier `PASS` because the
 * authoritative source has already attested. Insurance and RC stay `PENDING`
 * for human review because the photo of the certificate is what an admin
 * actually inspects — there is no Indian public registry to query.
 *
 * Failures (network / vendor / unsupported) leave the document `PENDING` and
 * surface the reason in `verifierMessage` so the rider UI can prompt a retry.
 */
export async function liveVerifyAndPersist(documentId: string, input: VerifyInput): Promise<void> {
  const outcome = await runLiveVerification(input);
  await (prisma as any).riderKycDocument.update({
    where: { id: documentId },
    data: {
      verifierProvider: outcome.provider,
      verifierStatus: outcome.status,
      verifierMessage: 'reason' in outcome ? outcome.reason : null,
      verifierResponse: 'details' in outcome ? (outcome.details as any) : null,
      verifierExternalRef: 'externalRef' in outcome ? outcome.externalRef : null,
      verifiedAt: outcome.status === 'PASS' || outcome.status === 'FAIL' ? new Date() : null,
      // PAN/DL auto-approve only when the verifier says PASS. Insurance/RC
      // stay PENDING for human review because the photo of the certificate
      // is what an admin actually inspects.
      ...(outcome.status === 'PASS' && (input.type === 'PAN_CARD' || input.type === 'DRIVING_LICENSE')
        ? { status: 'APPROVED', reviewedAt: new Date() }
        : {})
    }
  });
  await audit(outcome.status === 'PASS' ? 'kyc.verification.success' : 'kyc.verification.failure', {
    entityType: 'RiderKycDocument',
    entityId: documentId,
    after: {
      provider: outcome.provider,
      status: outcome.status,
      ...('reason' in outcome ? { reason: outcome.reason } : {})
    }
  });
}
