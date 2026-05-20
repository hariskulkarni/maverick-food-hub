/**
 * DELETE /api/customer/sessions/[id] — terminate one of the signed-in user's
 * own sessions. Ownership is enforced: we look up the UserSession and 404 if it
 * doesn't exist or belongs to a different user, so a user can never revoke
 * someone else's session by guessing an id.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { revokeSession } from '@/server/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  }

  const { id } = await params;

  const owned = await prisma.userSession.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!owned || owned.userId !== session.user.id) {
    return new Response('Not found', { status: 404, headers: NO_STORE });
  }

  await revokeSession(id, 'user_terminated');

  return Response.json({ ok: true }, { headers: NO_STORE });
}
