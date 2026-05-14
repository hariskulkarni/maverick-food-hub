import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { ordersToXlsx } from '@/server/exports';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  const buf = await ordersToXlsx(branch.id);
  return new Response(new Uint8Array(buf as Buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
}
