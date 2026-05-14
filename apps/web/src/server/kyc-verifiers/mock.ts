/**
 * Mock KYC verifier — default driver for dev / seed / tests.
 *
 *   - Format-validates via the same regexes as `validateForType`
 *   - 90% pass / 10% fail, randomised
 *   - Deterministic when `process.env.KYC_MOCK_SEED` is set, so test snapshots
 *     stay stable across runs
 *   - Adds a ~120ms latency to approximate a real network round-trip
 */

import type { KycVerifier, VerifyInput, VerifyOutcome } from './types';
import { validateForType } from '../kyc';
import type { KycDocumentType } from '@prisma/client';

function seededRandom(seed: string): number {
  // Tiny deterministic hash → [0, 1). Not cryptographic.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to [0, 1)
  return ((h >>> 0) % 100000) / 100000;
}

function pickRoll(input: VerifyInput): number {
  const seed = process.env.KYC_MOCK_SEED;
  if (seed) return seededRandom(`${seed}:${input.type}:${input.rawNumber}`);
  return Math.random();
}

export const mockVerifier: KycVerifier = {
  name: 'mock',
  async verify(input: VerifyInput): Promise<VerifyOutcome> {
    // Simulated latency
    await new Promise((r) => setTimeout(r, 120));

    const v = validateForType(input.type as KycDocumentType, input.rawNumber);
    if (!v.ok) {
      return { status: 'FAIL', reason: v.error, externalRef: `mock-${Date.now()}` };
    }

    const roll = pickRoll(input);
    if (roll < 0.9) {
      return {
        status: 'PASS',
        nameMatch: input.fullName ? true : undefined,
        details: { normalized: v.normalized, mock: true },
        externalRef: `mock-${Date.now()}`
      };
    }
    return {
      status: 'FAIL',
      reason: 'Mock verifier: random fail (10% rate). Set KYC_MOCK_SEED for deterministic outcomes.',
      externalRef: `mock-${Date.now()}`
    };
  }
};
