import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { requireSuperAdmin } from '@/server/tenancy';
import { notify } from '@/server/notifications';
import { brand } from '@/lib/brand';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;
  const app = await prisma.riderApplication.findUnique({ where: { id } });
  if (!app) return new Response('Not found', { status: 404 });
  if (app.status !== 'PENDING') return new Response('Already reviewed', { status: 409 });

  const user = await prisma.user.upsert({
    where: { phone: app.phone },
    update: { role: Role.RIDER, name: app.name },
    create: { phone: app.phone, name: app.name, role: Role.RIDER }
  });
  await prisma.riderProfile.upsert({
    where: { userId: user.id },
    update: { branchId: app.restaurantId ? undefined : null, vehicleType: app.vehicleType, vehicleNumber: app.vehicleNumber, approvedById: session.user.id, approvedAt: new Date() },
    create: { userId: user.id, branchId: null, vehicleType: app.vehicleType, vehicleNumber: app.vehicleNumber, approvedById: session.user.id, approvedAt: new Date() }
  });
  await prisma.riderApplication.update({ where: { id }, data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: session.user.id } });

  await notify.sms({
    to: app.phone, userId: user.id, template: 'rider.approved',
    body: `${brand.name}: You're approved to ride on the platform. Sign in at ${process.env.NEXTAUTH_URL ?? '/'}/login and toggle ONLINE to start claiming orders.`
  });
  return Response.json({ ok: true });
}
