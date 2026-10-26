/**
 * One eligibility check for every path that gives a rider an order — pool
 * claim, batch invitation (offer + accept) and admin assign (P1-9, P1-10,
 * P2-22). Keeps approval, account state, dispatch policy, KYC and the
 * concurrent-order cap in a single place.
 */
import { AssignmentStatus, type RiderType } from '@prisma/client';
import { prisma } from './db';
import { riderCanClaimOrder, resolveDedicatedGroup, type OrderWithRestaurant } from './rider-sourcing';
import { riderKycGate } from './rider-kyc-gate';
import { getRiderMaxActiveOrders } from './platform-settings';

export type IneligibleCode =
  | 'not_found'
  | 'not_approved'
  | 'account_inactive'
  | 'offline'
  | 'policy'
  | 'kyc_incomplete'
  | 'at_capacity';

export type Eligibility = { ok: true } | { ok: false; code: IneligibleCode; message: string; status: number };

export interface EligibilityOpts {
  /** Require isOnline (pool/batch: yes; admin assign: yes). */
  requireOnline?: boolean;
  /**
   * Admin assign: a restaurant admin explicitly picking a fleet rider may skip
   * the DEDICATED_FIRST fallback wait (the mode itself is still enforced).
   */
  ignoreFleetFallbackWindow?: boolean;
  now?: Date;
}

const ACTIVE: AssignmentStatus[] = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP];

export async function activeAssignmentCount(riderId: string): Promise<number> {
  return prisma.riderAssignment.count({ where: { riderId, status: { in: ACTIVE } } });
}

export async function checkRiderEligibility(
  riderId: string,
  order: OrderWithRestaurant,
  opts: EligibilityOpts = {},
): Promise<Eligibility> {
  const rider = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    select: {
      id: true,
      approvedAt: true,
      isOnline: true,
      riderType: true,
      dedicatedRestaurantId: true,
      user: { select: { deletedAt: true, suspendedAt: true } },
    },
  });
  if (!rider) return { ok: false, code: 'not_found', status: 404, message: 'Rider not found.' };
  if (rider.user.deletedAt || rider.user.suspendedAt) {
    return { ok: false, code: 'account_inactive', status: 403, message: 'This rider account is not active.' };
  }
  if (!rider.approvedAt) return { ok: false, code: 'not_approved', status: 403, message: 'Rider not approved.' };
  if (opts.requireOnline && !rider.isOnline) {
    return { ok: false, code: 'offline', status: 400, message: 'Rider must be online.' };
  }

  const group = await resolveDedicatedGroup({
    id: rider.id,
    riderType: rider.riderType as RiderType,
    dedicatedRestaurantId: rider.dedicatedRestaurantId,
  });
  const policyOrder = opts.ignoreFleetFallbackWindow ? { ...order, readyAt: new Date(0) } : order;
  if (!riderCanClaimOrder(group, policyOrder, opts.now ?? new Date())) {
    return { ok: false, code: 'policy', status: 403, message: 'This order is not available to this rider.' };
  }

  const kyc = await riderKycGate(rider.id, opts.now);
  if (!kyc.canGoOnline) {
    return { ok: false, code: 'kyc_incomplete', status: 403, message: kyc.message ?? 'KYC incomplete.' };
  }

  const [cap, active] = await Promise.all([getRiderMaxActiveOrders(), activeAssignmentCount(rider.id)]);
  if (active >= cap) {
    return {
      ok: false,
      code: 'at_capacity',
      status: 409,
      message: `You already have ${active} active ${active === 1 ? 'delivery' : 'deliveries'} (limit ${cap}). Finish one first.`,
    };
  }
  return { ok: true };
}
