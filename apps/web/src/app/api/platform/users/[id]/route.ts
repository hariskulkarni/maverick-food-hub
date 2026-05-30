import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';
import { optionalString } from '@/server/zod-helpers';

/**
 * GET    — return a full user profile (orders, wallet, loyalty, addresses, recent notifications)
 * PATCH  — limited admin patches: name, suspend/reinstate, adjust wallet. All audited.
 */

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const [u, orders, payments, wallet, loyalty, addresses, notifications, riderProfile] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.order.findMany({
      where: { customerId: id },
      orderBy: { placedAt: 'desc' },
      take: 25,
      include: { branch: { include: { restaurant: { select: { name: true, slug: true } } } } }
    }),
    prisma.payment.findMany({ where: { order: { customerId: id } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.wallet.findUnique({ where: { userId: id } }),
    prisma.loyaltyAccount.findUnique({ where: { userId: id } }),
    prisma.address.findMany({ where: { userId: id } }),
    prisma.notificationLog.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 15 }),
    prisma.riderProfile.findUnique({ where: { userId: id }, include: { branch: { select: { name: true } } } })
  ]);
  if (!u) return new Response('Not found', { status: 404 });

  const aggregate = await prisma.order.aggregate({
    where: { customerId: id, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } },
    _sum: { total: true },
    _count: true
  });

  return Response.json({
    user: u,
    orders,
    payments,
    wallet,
    loyalty,
    addresses,
    notifications,
    riderProfile,
    lifetime: { gmv: Number(aggregate._sum.total ?? 0), orderCount: aggregate._count }
  });
}

const PatchBody = z.object({
  name: optionalString(80),
  walletDelta: z.number().optional(),
  walletNote: z.string().optional(),
  suspended: z.boolean().optional(),
  suspendReason: z.string().max(300).optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await prisma.user.findUnique({ where: { id }, select: { id: true, suspendedAt: true } });
  if (!before) return new Response('Not found', { status: 404 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  await prisma.$transaction(async (tx) => {
    if (data.name) {
      await tx.user.update({ where: { id }, data: { name: data.name } });
    }
    if (data.walletDelta !== undefined && data.walletDelta !== 0) {
      const w = await tx.wallet.findUnique({ where: { userId: id } });
      const balance = Number(w?.balance ?? 0) + data.walletDelta;
      if (balance < 0) throw new Response('Cannot go negative', { status: 400 });
      if (!w) await tx.wallet.create({ data: { userId: id, balance: balance as any } });
      else await tx.wallet.update({ where: { userId: id }, data: { balance: balance as any } });
      const walletId = w?.id ?? (await tx.wallet.findUnique({ where: { userId: id } }))!.id;
      await tx.walletTransaction.create({
        data: {
          walletId,
          amount: data.walletDelta as any,
          type: 'ADJUSTMENT',
          note: data.walletNote ?? 'Adjusted by platform admin'
        }
      });
    }
    if (data.suspended !== undefined) {
      // Real suspension: set/clear suspendedAt. On suspend, also null the
      // active-session pointer so the user is force-logged-out everywhere
      // immediately (their JWT's sid no longer matches). Login is blocked in
      // src/server/auth.ts while suspendedAt is set.
      await tx.user.update({
        where: { id },
        data: {
          suspendedAt: data.suspended ? new Date() : null,
          suspendedReason: data.suspended ? (data.suspendReason ?? 'Suspended by platform admin') : null,
          ...(data.suspended ? { currentSessionId: null } : {})
        }
      });
    }
  });

  // Audit (each writes its own row; outside the txn so a logging hiccup can't
  // roll back the action).
  if (data.walletDelta !== undefined && data.walletDelta !== 0) {
    await audit(data.walletDelta >= 0 ? 'wallet.credit' : 'wallet.debit', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      entityType: 'User',
      entityId: id,
      after: { amount: data.walletDelta, note: data.walletNote ?? null },
      ipAddress: ip
    }).catch(() => {});
  }
  if (data.suspended !== undefined) {
    await audit('user.suspend', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      entityType: 'User',
      entityId: id,
      before: { suspended: Boolean(before.suspendedAt) },
      after: { suspended: data.suspended, reason: data.suspended ? (data.suspendReason ?? null) : null },
      ipAddress: ip
    }).catch(() => {});
  }

  return Response.json({ ok: true });
}
