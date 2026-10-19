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
  // C13: never silently fall back to the mock verifier in production. The mock
  // passes ~90% of format-valid documents at random with no external check, and
  // KYC_VERIFIER is documented in none of the env examples, so an operator who
  // never set it would be approving rider identities on a coin flip.
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
    throw new Error(
      `KYC_VERIFIER is '${driver}' in production — refusing the mock verifier. ` +
        `Set KYC_VERIFIER=karza|surepass with the matching credentials, or DEMO_MODE=true for a demo deployment.`
    );
  }
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
