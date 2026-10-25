import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { imageRef, parseOrJsonError } from '@/server/zod-helpers';
import { branchOwned, callerRestaurantId, categoryInBranch, notFound } from '../_tenant';

const Body = z.object({
  branchId: z.string(),
  categoryId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  isVeg: z.boolean(),
  spicyLevel: z.number().int().min(0).max(3).optional(),
  prepTimeMin: z.number().int().min(1).max(180).optional(),
  imageUrl: imageRef.optional().nullable(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  isRecommended: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  // Tenancy: the branch must be one of the caller's, and the category must sit
  // in that branch — never trust body ids.
  const restaurantId = await callerRestaurantId();
  if (restaurantId instanceof Response) return restaurantId;
  if (!(await branchOwned(data.branchId, restaurantId))) return notFound('Branch');
  if (!(await categoryInBranch(data.categoryId, data.branchId))) return notFound('Category');
  const item = await prisma.menuItem.create({ data: { ...data, price: data.price as any } });
  return Response.json(item);
}
