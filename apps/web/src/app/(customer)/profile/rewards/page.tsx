/**
 * Customer Rewards page — the celebratory surface.
 *
 * Server component. Calls the two server-side listings and hands them to the
 * client for rendering. Redirects to /login when unauthenticated so the page
 * can assume a real userId everywhere downstream.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import {
  listChallengesForCustomer,
  listRewardsForCustomer
} from '@/server/challenges';
import { RewardsClient } from './rewards-client';

export const metadata = { title: 'My Rewards' };
export const dynamic = 'force-dynamic';

export default async function RewardsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/profile/rewards');

  const [challenges, rewards] = await Promise.all([
    listChallengesForCustomer(session.user.id),
    listRewardsForCustomer(session.user.id)
  ]);

  return (
    <div className="container py-8">
      <RewardsClient
        challenges={JSON.parse(JSON.stringify(challenges))}
        rewards={JSON.parse(JSON.stringify(rewards))}
      />
    </div>
  );
}
