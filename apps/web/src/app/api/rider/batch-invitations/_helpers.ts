/**
 * Shared serializers + auth shortcut for the /api/rider/batch-invitations
 * route group. Kept out of any `route.ts` file because Next.js only allows
 * HTTP-method exports from route files — any non-handler export breaks the
 * production build.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import type { BatchInvitation } from '@prisma/client';

export interface AuthedRider {
  userId: string;
  profileId: string;
}

/**
 * Resolve the calling RIDER, or return a Response to send back if the caller
 * isn't authenticated as one. Used at the top of every batch-invitations
 * route to keep the handler bodies clean.
 */
export async function requireRider(): Promise<
  | { ok: true; rider: AuthedRider }
  | { ok: false; response: Response }
> {
  const session = await auth();
  if (session?.user.role !== 'RIDER') {
    return { ok: false, response: new Response('Forbidden', { status: 403 }) };
  }
  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) {
    return { ok: false, response: new Response('Forbidden', { status: 403 }) };
  }
  return { ok: true, rider: { userId: session.user.id, profileId: profile.id } };
}

/**
 * Serialise a BatchInvitation row with its joined Order detail down to the
 * shape the rider app's modal needs. Computes `secondsLeft` server-side off
 * `expiresAt` so the client and server share the same clock as the modal
 * countdown reaches zero.
 */
export interface SerializedBatchInvitation {
  id: string;
  orderId: string;
  status: BatchInvitation['status'];
  detourKm: number;
  extraEarnings: number;
  pickupEtaMin: number | null;
  invitedAt: string;
  expiresAt: string;
  secondsLeft: number;
  order: {
    code: string;
    total: number;
    branchName: string;
    customerArea: string;
  };
}

export function serializeInvitation(
  inv: BatchInvitation & {
    order: {
      code: string;
      total: { toString(): string };
      branch: { name: string };
      address: { line1: string; city: string } | null;
    };
  },
  now: Date = new Date()
): SerializedBatchInvitation {
  const secondsLeft = Math.max(
    0,
    Math.ceil((inv.expiresAt.getTime() - now.getTime()) / 1000)
  );
  // Compact one-liner for the customer area shown in the modal.
  const customerArea = inv.order.address
    ? `${inv.order.address.line1}, ${inv.order.address.city}`
    : 'Customer area';
  return {
    id: inv.id,
    orderId: inv.orderId,
    status: inv.status,
    detourKm: Number(inv.detourKm),
    extraEarnings: Number(inv.extraEarnings.toString()),
    pickupEtaMin: inv.pickupEtaMin,
    invitedAt: inv.invitedAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
    secondsLeft,
    order: {
      code: inv.order.code,
      total: Number(inv.order.total.toString()),
      branchName: inv.order.branch.name,
      customerArea,
    },
  };
}
