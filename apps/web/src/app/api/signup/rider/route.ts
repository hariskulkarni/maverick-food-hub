import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';

const Body = z.object({
  restaurantId: z.string().optional(),    // optional hint only
  name: z.string().min(2),
  phone: z.string().min(8).max(20),
  vehicleType: z.string().default('BIKE'),
  vehicleNumber: z.string().optional(),
  preferredZone: z.string().optional(),
  notes: z.string().optional()
});

export async function POST(req: NextRequest) {
  const data = Body.parse(await req.json());
  const existing = await prisma.riderApplication.findUnique({ where: { phone: data.phone } }).catch(() => null);
  if (existing) {
    if (existing.status === 'PENDING') return new Response('You already applied — check back soon', { status: 409 });
    if (existing.status === 'APPROVED') return new Response('You are already approved — sign in at /login', { status: 409 });
  }
  const app = await prisma.riderApplication.create({ data });
  return Response.json({ id: app.id, status: app.status });
}
