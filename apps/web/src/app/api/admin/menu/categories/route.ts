import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { branchOwned, callerRestaurantId, notFound } from '../_tenant';

const Body = z.object({ branchId: z.string(), name: z.string().min(1), slug: z.string().min(1), sortOrder: z.number().optional() });

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  // Tenancy: only create categories in one of the caller's branches.
  const restaurantId = await callerRestaurantId();
  if (restaurantId instanceof Response) return restaurantId;
  if (!(await branchOwned(data.branchId, restaurantId))) return notFound('Branch');
  const c = await prisma.category.create({ data });
  return Response.json(c);
}
