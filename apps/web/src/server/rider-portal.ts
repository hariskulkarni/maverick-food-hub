/**
 * Rider web portal (/rider) — server-side session resolution for PAGES.
 *
 * API calls from the portal go through the ordinary /api/rider/* routes, which
 * read the same cookie via rider-auth's readRiderBearer (one auth code path).
 * Pages are server components and need a richer answer than "valid / not" so
 * they can explain WHY a rider can't get in (suspended, deleted, not a rider,
 * session ended) — that's what this helper returns. It reuses the token
 * verification + revocation check from rider-auth; nothing is re-implemented.
 *
 * No same-origin check here: rendering a page is a read-only top-level
 * navigation (a rider tapping a WhatsApp link must land signed in). Every
 * mutation still goes through /api/rider/*, where the cookie CSRF rule applies.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { prisma } from './db';
import { RIDER_COOKIE, verifyRiderToken, riderTokenActive } from './rider-auth';

export type RiderPortalState =
  | { state: 'signed_out' }
  | { state: 'expired' }
  | { state: 'suspended' }
  | { state: 'deleted' }
  | { state: 'not_rider' }
  | {
      state: 'ok';
      expiresAt: string;
      rider: {
        userId: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        avatarUrl: string | null;
        profileId: string | null;
        approvedAt: string | null;
        riderType: 'FLEET' | 'DEDICATED' | null;
        dedicatedRestaurant: string | null;
      };
    };

export async function getRiderPortalState(): Promise<RiderPortalState> {
  const raw = (await cookies()).get(RIDER_COOKIE)?.value;
  if (!raw) return { state: 'signed_out' };
  const claims = verifyRiderToken(raw);
  if (!claims || claims.legacy) return { state: 'expired' };
  const u = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: {
      id: true,
      role: true,
      name: true,
      phone: true,
      email: true,
      avatarUrl: true,
      suspendedAt: true,
      deletedAt: true,
      currentSessionId: true,
      riderProfile: {
        select: { id: true, approvedAt: true, riderType: true, dedicatedRestaurant: { select: { name: true } } },
      },
    },
  });
  if (!u || u.deletedAt) return { state: 'deleted' };
  if (u.role !== 'RIDER') return { state: 'not_rider' };
  if (u.suspendedAt) return { state: 'suspended' };
  if (!(await riderTokenActive(claims, u.currentSessionId))) return { state: 'expired' };
  return {
    state: 'ok',
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    rider: {
      userId: u.id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      avatarUrl: u.avatarUrl,
      profileId: u.riderProfile?.id ?? null,
      approvedAt: u.riderProfile?.approvedAt?.toISOString() ?? null,
      riderType: (u.riderProfile?.riderType as 'FLEET' | 'DEDICATED' | undefined) ?? null,
      dedicatedRestaurant: u.riderProfile?.dedicatedRestaurant?.name ?? null,
    },
  };
}

/** Human copy for each non-ok state (login page banner). */
export const PORTAL_STATE_MESSAGE: Record<Exclude<RiderPortalState['state'], 'ok' | 'signed_out'>, string> = {
  expired: 'Your session has ended — you signed in somewhere else (for example the Rider app) or signed out. Please sign in again.',
  suspended: 'Your rider account is suspended. Contact Flavrly rider support to find out why and how to get reinstated.',
  deleted: 'This rider account no longer exists. If you think this is a mistake, contact Flavrly rider support.',
  not_rider: 'This phone number is not registered as a Flavrly rider.',
};
