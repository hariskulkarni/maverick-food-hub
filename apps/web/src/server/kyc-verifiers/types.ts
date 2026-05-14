/**
 * Pluggable KYC verifier contract.
 *
 * Indian KYC verification is paid-third-party — UIDAI, NSDL (PAN), and Sarathi
 * (DL) don't expose public APIs to platforms directly. Instead we wrap one of
 * the paid aggregators (Karza, Surepass, Signzy) behind this interface, with
 * an in-process `mock` adapter for dev / seed / tests.
 *
 * Each adapter returns a single discriminated VerifyOutcome — the structural
 * shape going into the database lives at this boundary only. Vendor-specific
 * payload shapes are mapped to VerifyOutcome inside each adapter.
 */

export interface VerifyInput {
  type: 'AADHAAR' | 'DRIVING_LICENSE' | 'VEHICLE_INSURANCE' | 'PAN_CARD' | 'VEHICLE_RC';
  rawNumber: string;
  fullName?: string;
  dateOfBirth?: string; // YYYY-MM-DD, optional but improves DL/PAN match
}

export type VerifyOutcome =
  | { status: 'PASS'; nameMatch?: boolean; details?: Record<string, unknown>; externalRef?: string }
  | { status: 'FAIL'; reason: string; externalRef?: string }
  | { status: 'ERROR'; reason: string }            // network/auth/timeout — retryable
  | { status: 'UNSUPPORTED' };                     // provider doesn't verify this type

export interface KycVerifier {
  name: string;
  verify(input: VerifyInput): Promise<VerifyOutcome>;
}
