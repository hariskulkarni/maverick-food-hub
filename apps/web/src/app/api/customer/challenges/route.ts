/**
 * GET /api/customer/challenges
 * Returns the active challenges + the authenticated customer's progress on each.
 * Returns an empty array when no session — the Rewards page renders an empty
 * state in that case rather than redirecting.
 */
import { auth } from '@/server/auth';
import { listChallengesForCustomer } from '@/server/challenges';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ challenges: [] });
  const challenges = await listChallengesForCustomer(session.user.id);
  return Response.json({ challenges });
}
