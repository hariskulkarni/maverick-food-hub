/**
 *   GET  /api/admin/tables  — list this branch's tables (sortOrder, then name)
 *   POST /api/admin/tables  — create a table for this branch
 *
 * Scoped to the signed-in admin's primary branch. ADMIN only. zod validation.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { primaryBranchForCurrentRestaurant, serializeTable } from './_helpers';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(60),
  capacity: z.number().int().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branch } = await primaryBranchForCurrentRestaurant();

  const tables = await prisma.restaurantTable.findMany({
    where: { branchId: branch.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  return Response.json({ branchId: branch.id, tables: serializeTable(tables) });
}

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branch } = await primaryBranchForCurrentRestaurant();

  const data = CreateBody.parse(await req.json());

  const created = await prisma.restaurantTable.create({
    data: {
      branchId: branch.id,
      name: data.name,
      capacity: data.capacity,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true
    }
  });
  return Response.json(serializeTable(created));
}
