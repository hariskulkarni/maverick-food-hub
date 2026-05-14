import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const profile = await prisma.riderProfile.findUnique({
    where: { id },
    include: { user: true, branch: { include: { restaurant: { select: { name: true } } } } }
  });
  if (!profile) return new Response('Not found', { status: 404 });

  const thirty = new Date(Date.now() - 30 * 86_400_000);
  const [recent, earningsAgg, ratingHistory] = await Promise.all([
    prisma.riderAssignment.findMany({
      where: { riderId: id },
      orderBy: { assignedAt: 'desc' },
      take: 25,
      include: { order: { include: { branch: { include: { restaurant: { select: { name: true } } } } } } }
    }),
    prisma.riderAssignment.aggregate({
      where: { riderId: id, status: 'DELIVERED', deliveredAt: { gte: thirty } },
      _sum: { earningsAmt: true, tipAmt: true, baseEarningsAmt: true, bonusAmt: true },
      _count: true,
      _avg: { customerRating: true }
    }),
    prisma.riderAssignment.findMany({
      where: { riderId: id, customerRating: { not: null }, deliveredAt: { gte: thirty } },
      select: { customerRating: true, customerComment: true, deliveredAt: true },
      orderBy: { deliveredAt: 'desc' },
      take: 10
    })
  ]);

  return Response.json({ profile, recent, earnings30d: earningsAgg, ratingHistory });
}

const PatchBody = z.object({
  earningsBonus: z.number().optional(),
  bonusReason: z.string().optional(),
  approve: z.boolean().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  if (data.earningsBonus !== undefined && data.earningsBonus !== 0) {
    await prisma.riderProfile.update({
      where: { id },
      data: { totalEarnings: { increment: data.earningsBonus as any } }
    });
    // Audit trail via NotificationLog
    const profile = await prisma.riderProfile.findUnique({ where: { id }, select: { userId: true } });
    if (profile) {
      await prisma.notificationLog.create({
        data: {
          userId: profile.userId,
          channel: 'PUSH',
          to: 'admin-audit',
          subject: `Earnings ${data.earningsBonus > 0 ? '+' : ''}₹${data.earningsBonus}`,
          body: data.bonusReason ?? 'Admin earnings adjustment',
          template: 'admin.rider.earnings',
          status: 'SENT',
          sentAt: new Date()
        }
      });
    }
  }
  if (data.approve) {
    await prisma.riderProfile.update({ where: { id }, data: { approvedAt: new Date() } });
  }
  return Response.json({ ok: true });
}
