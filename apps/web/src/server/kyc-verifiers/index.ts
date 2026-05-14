/**
 * KYC verifier dispatch.
 *
 * Driver selection is env-driven: `KYC_VERIFIER=mock|karza|surepass`. Default
 * is `mock` so dev / seed / tests run without any external dependency.
 *
 * `runLiveVerification` is the single call-site for the rest of the app — it
 * picks the configured verifier, attaches the provider name to the outcome,
 * and swallows thrown errors (defence-in-depth against an adapter regression
 * blowing up an upload).
 */

import type { KycVerifier, VerifyInput, VerifyOutcome } from './types';
import { mockVerifier } from './mock';
import { karzaVerifier } from './karza';
import { surepassVerifier } from './surepass';

export type { KycVerifier, VerifyInput, VerifyOutcome } from './types';

export function pickVerifier(): KycVerifier {
  const driver = process.env.KYC_VERIFIER ?? 'mock';
  if (driver === 'karza') return karzaVerifier;
  if (driver === 'surepass') return surepassVerifier;
  return mockVerifier;
}

export async function runLiveVerification(
  input: VerifyInput
): Promise<VerifyOutcome & { provider: string }> {
  const v = pickVerifier();
  const outcome = await v
    .verify(input)
    .catch((e: any) => ({ status: 'ERROR' as const, reason: e?.message ?? 'verifier threw' }));
  return { ...outcome, provider: v.name };
}
