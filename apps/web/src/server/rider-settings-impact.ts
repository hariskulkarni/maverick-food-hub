/**
 * Read-only "who would be blocked right now" counts for the rider gates on
 * /platform/rider-settings. Evaluates every active rider (approved, account
 * not deleted/suspended) as if the gate were ON, so the super admin sees the
 * impact before flipping it.
 */
import type { RiderGateImpact } from '@/lib/rider-settings';
import { prisma } from './db';
import { evaluateKycGate } from './rider-kyc-gate';
import { requiredGapsForUsers } from './training/service';

export type { RiderGateImpact };

export async function computeRiderGateImpact(now: Date = new Date()): Promise<RiderGateImpact> {
  const riders = await prisma.riderProfile.findMany({
    // Test riders (server/test-accounts.ts) are exempt from the gates — not real impact.
    where: { approvedAt: { not: null }, user: { deletedAt: null, suspendedAt: null, isTestAccount: false } },
    select: {
      id: true,
      isOnline: true,
      user: { select: { id: true, createdAt: true } },
      kycDocuments: { select: { type: true, status: true, expiresOn: true } },
    },
  });

  const kyc: RiderGateImpact['kyc'] = { blocked: 0, blockedOnline: 0, byType: {} };
  for (const r of riders) {
    const { blockingTypes } = evaluateKycGate(r.kycDocuments, true, now);
    if (blockingTypes.length === 0) continue;
    kyc.blocked++;
    if (r.isOnline) kyc.blockedOnline++;
    for (const t of blockingTypes) kyc.byType[t] = (kyc.byType[t] ?? 0) + 1;
  }

  const gaps = await requiredGapsForUsers(
    riders.map((r) => ({ id: r.user.id, since: r.user.createdAt })),
    'RIDER',
    { onlyBlocksShift: true, now },
  );
  const training = { blocked: 0, blockedOnline: 0 };
  for (const r of riders) {
    if (!gaps.has(r.user.id)) continue;
    training.blocked++;
    if (r.isOnline) training.blockedOnline++;
  }

  return {
    activeRiders: riders.length,
    onlineRiders: riders.filter((r) => r.isOnline).length,
    kyc,
    training,
    computedAt: now.toISOString(),
  };
}
