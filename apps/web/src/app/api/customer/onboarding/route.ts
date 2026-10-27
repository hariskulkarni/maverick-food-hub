/**
 * POST /api/customer/onboarding  { name?, favoriteCuisines?, complete? }
 *
 * The optional "about you" answers from /welcome (first name + favourite
 * cuisines), and `complete: true` when the customer finishes or skips through
 * the onboarding (sets User.onboardedAt so it is not shown again). CUSTOMER
 * only; completing requires a verified phone, which is the one mandatory step.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { CUISINES, MAX_CUISINES, NAME_MAX, validateDisplayName } from '@/lib/onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    name: z.string().max(NAME_MAX * 2).optional(),
    favoriteCuisines: z.array(z.enum(CUISINES)).max(MAX_CUISINES).optional(),
    complete: z.literal(true).optional(),
  })
  .refine((b) => b.name !== undefined || b.favoriteCuisines !== undefined || b.complete, { message: 'Nothing to save.' });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  if (session.user.role !== 'CUSTOMER') return Response.json({ error: 'Customers only.' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' }, { status: 400 });
  }
  const { name, favoriteCuisines, complete } = parsed.data;
  const data: { name?: string; favoriteCuisines?: string[]; onboardedAt?: Date } = {};
  if (name !== undefined && name.trim()) {
    const err = validateDisplayName(name);
    if (err) return Response.json({ error: err }, { status: 400 });
    data.name = name.trim();
  }
  if (favoriteCuisines !== undefined) data.favoriteCuisines = Array.from(new Set(favoriteCuisines));
  if (complete) {
    if (!session.user.phoneVerified) {
      return Response.json({ error: 'Verify your mobile number first.', code: 'PHONE_VERIFICATION_REQUIRED' }, { status: 403 });
    }
    data.onboardedAt = new Date();
  }
  if (Object.keys(data).length === 0) return Response.json({ ok: true });
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { name: true, favoriteCuisines: true, onboardedAt: true },
  });
  return Response.json({ ok: true, user });
}
