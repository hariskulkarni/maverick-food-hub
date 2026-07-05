import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/customer/delete-account — self-serve "right to erasure".
 *
 * Anonymises the signed-in customer's personal data (name, email, phone,
 * avatar) and deletes their saved addresses + revokes all sessions. Past
 * orders/reservations are RETAINED in anonymised form (they now point at a
 * "Deleted account" user) because retaining transaction records is a legitimate
 * legal/tax obligation under the DPDP Act — but they no longer carry PII.
 *
 * Only CUSTOMER accounts can self-delete here; staff/partner accounts are
 * managed by the platform and must be closed via support.
 */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: 'You are not signed in.' }, { status: 401 });
  if (session?.user?.role !== 'CUSTOMER') {
    return Response.json(
      { error: 'Staff and partner accounts are managed by the platform. Please contact support to close them.' },
      { status: 403 },
    );
  }

  try {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.address.deleteMany({ where: { userId } });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'account_deleted' },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted account',
          email: null,
          phone: null,
          avatarUrl: null,
          passwordHash: null,
          currentSessionId: null,
          suspendedReason: 'Account deleted at user request',
        },
      });
    });
    log.info({ userId }, 'customer account deleted (anonymised) at user request');
    return Response.json({ ok: true });
  } catch (e) {
    log.error({ err: e, userId }, 'account deletion failed');
    return Response.json(
      { error: 'Could not delete your account right now. Please try again, or contact support.' },
      { status: 500 },
    );
  }
}
