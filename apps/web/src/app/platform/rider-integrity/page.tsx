import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { can } from '@/server/permissions';
import { RiderIntegrityClient } from './integrity-client';

export const metadata = { title: 'Platform · Location integrity' };
export const dynamic = 'force-dynamic';

/**
 * Rider location-integrity (anti-fraud) review queue. View: riders:read.
 * Actions (clear / keep / pause / resume) + policy changes: riders:write.
 */
export default async function RiderIntegrityPage() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'riders:read')) redirect('/platform');
  const canWrite = can(session.user.role, 'riders:write');
  return <RiderIntegrityClient canWrite={canWrite} />;
}
