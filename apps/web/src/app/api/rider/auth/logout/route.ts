/**
 * POST /api/rider/auth/logout  (Bearer)
 *
 * Ends the rider's server session so the token stops working everywhere
 * (P1-11), and clears the device push token so a signed-out phone stops
 * getting order pings (P2-20). Always 200 — logging out an already-dead token
 * is a no-op.
 */
import { prisma } from '@/server/db';
import { readRiderBearer } from '@/server/rider-auth';
import { revokeSession } from '@/server/sessions';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const bearer = await readRiderBearer();
  if (bearer.kind !== 'valid') return Response.json({ ok: true });
  const userId = bearer.user.id;
  if (bearer.claims.sid) {
    await revokeSession(bearer.claims.sid, 'logout');
  } else {
    // Legacy token (no sid): a session row created now marks every token
    // issued before this instant as dead (see riderTokenActive).
    await prisma.userSession
      .create({ data: { userId, revokedAt: new Date(), revokedReason: 'logout' } })
      .catch(() => {});
  }
  await prisma.riderProfile.updateMany({ where: { userId }, data: { expoPushToken: null, isOnline: false } });
  await audit('auth.logout', { actorId: userId, actorRole: 'RIDER', entityType: 'User', entityId: userId, after: { provider: 'rider-token' } }).catch(() => {});
  return Response.json({ ok: true });
}
