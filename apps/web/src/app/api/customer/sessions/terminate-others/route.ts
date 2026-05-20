/**
 * POST /api/customer/sessions/terminate-others — revoke all of the signed-in
 * user's sessions except the current active one. We iterate listSessions (which
 * is already scoped to this user), skip the `active` row and any already-revoked
 * rows, and revoke the rest. Ownership is implicit: every id comes from the
 * user's own session list.
 */
import { auth } from '@/server/auth';
import { listSessions, revokeSession } from '@/server/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  }

  const rows = await listSessions(session.user.id);
  const toRevoke = rows.filter((s) => !s.active && s.revokedAt === null);

  await Promise.all(toRevoke.map((s) => revokeSession(s.id, 'user_terminated')));

  return Response.json({ ok: true, revoked: toRevoke.length }, { headers: NO_STORE });
}
