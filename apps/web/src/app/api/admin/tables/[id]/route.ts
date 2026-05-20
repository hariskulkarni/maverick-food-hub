/**
 *   PATCH  /api/admin/tables/[id] — edit a table (name, capacity, sortOrder, isActive)
 *   DELETE /api/admin/tables/[id] — soft-delete (sets isActive = false)
 *
 * The table must belong to the signed-in admin's primary branch. ADMIN only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { primaryBranchForCurrentRestaurant, serializeTable } from '../_helpers';

export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  name: z.string().min(1).max(60).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId: branch.id } });
  if (!existing) return new Response('Not found', { status: 404 });

  const data = PatchBody.parse(await req.json());
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.capacity !== undefined) patch.capacity = data.capacity;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const updated = await prisma.restaurantTable.update({ where: { id }, data: patch });
  return Response.json(serializeTable(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const existing = await prisma.restaurantTable.findFirst({ where: { id, branchId: branch.id } });
  if (!existing) return new Response('Not found', { status: 404 });

  // Soft-delete: tables are referenced by reservations (FK Restrict), so we
  // deactivate rather than hard-delete.
  const updated = await prisma.restaurantTable.update({ where: { id }, data: { isActive: false } });
  return Response.json(serializeTable(updated));
}
