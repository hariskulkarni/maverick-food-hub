import { notFound, redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { can } from '@/server/permissions';
import { prisma } from '@/server/db';
import { InsightsClient } from './insights-client';

export const metadata = { title: 'Platform · Rider insights' };
export const dynamic = 'force-dynamic';

/** Rider operational insights. Gate: riders:read (middleware enforces it too). */
export default async function RiderInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'riders:read')) redirect('/platform');
  const { id } = await params;
  const rider = await prisma.riderProfile.findUnique({ where: { id }, select: { id: true } });
  if (!rider) notFound();
  return <InsightsClient riderId={rider.id} />;
}
