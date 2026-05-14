/**
 * GET /api/customer/rewards
 * Returns the ChallengeRewards the authenticated customer has earned, each
 * with the linked Offer (so the UI can show "Use code MAVE-X7P9" + expiry)
 * and the parent Challenge (name + description for headline copy).
 * Returns an empty array when no session.
 */
import { auth } from '@/server/auth';
import { listRewardsForCustomer } from '@/server/challenges';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ rewards: [] });
  const rewards = await listRewardsForCustomer(session.user.id);
  return Response.json({ rewards });
}
