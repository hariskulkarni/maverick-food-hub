/**
 * Admin observation dashboard for one challenge.
 *
 *   GET /api/admin/challenges/[id]/progress
 *     Returns the top 50 ChallengeProgress rows for this challenge, joined to
 *     the user (name + phone), sorted by updatedAt DESC. Used by the "Observe"
 *     drawer on the admin challenges list so SUPER_ADMINs can see who's
 *     progressing toward a reward in real time.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const challenge = await (prisma as any).challenge.findUnique({
    where: { id },
    select: { id: true, name: true, target: true, type: true }
  });
  if (!challenge) return new Response('Not found', { status: 404 });

  const rows = await (prisma as any).challengeProgress.findMany({
    where: { challengeId: id },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } }
    }
  });

  const result = (rows as any[]).map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user?.name ?? null,
    userPhone: r.user?.phone ?? null,
    userEmail: r.user?.email ?? null,
    value: Number(r.value),
    target: challenge.target,
    percent: Math.min(100, Math.round((Number(r.value) / Math.max(1, challenge.target)) * 100)),
    completed: r.completed,
    completedAt: r.completedAt,
    lastOrderId: r.lastOrderId,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt
  }));

  return Response.json({ challenge, progress: result });
}
