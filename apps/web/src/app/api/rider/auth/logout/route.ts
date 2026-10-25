/**
 * POST /api/rider/auth/logout  (Bearer)
 *
 * Ends THIS token's rider session (P1-11; the app's or the web portal's — the
 * other surface stays signed in), and clears the device push token so a signed-out phone stops
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
      .create({ data: { userId, client: 'rider-app', revokedAt: new Date(), revokedReason: 'logout' } })
      .catch(() => {});
  }
  // Only the APP's logout takes the rider offline and drops the phone's push
  // token. Signing out of the web portal (cookie transport) must not touch a
  // delivery that may be running in the app right now.
  if (bearer.transport === 'bearer') {
    await prisma.riderProfile.updateMany({ where: { userId }, data: { expoPushToken: null, isOnline: false } });
  }
  await audit('auth.logout', { actorId: userId, actorRole: 'RIDER', entityType: 'User', entityId: userId, after: { provider: bearer.transport === 'cookie' ? 'rider-web' : 'rider-token' } }).catch(() => {});
  return Response.json({ ok: true });
}
