/**
 * PATCH /api/rider/profile
 *
 * Self-service edit endpoint for the rider Personal tab. A rider can only
 * patch their own row (the session id is the only identifier accepted —
 * there's no `:id` param). Editable fields are intentionally non-sensitive
 * — phone (auth identifier), KYC numbers, payouts, ratings, and approval
 * state are all read-only here.
 *
 * Fields:
 *   name              — display name (≤ 80 chars), stored on User
 *   email             — optional, validated; stored on User (unique)
 *   emergencyPhone    — secondary contact; stored on RiderPreferences
 *   preferredLanguage — 'en' | 'hi' | 'kn' | 'te'; stored on RiderPreferences
 *
 * `emergencyPhone` and `preferredLanguage` aren't columns on User — they live
 * on the 1:1 RiderPreferences row (riderId @unique), upserted here so they
 * persist across sessions and are readable via GET /api/rider/preferences.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { optionalString, optionalEmail } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATCH_BODY = z.object({
  name: optionalString(80),
  email: optionalEmail.nullable(),
  emergencyPhone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{6,20}$/, 'Invalid phone number')
    .optional()
    .nullable(),
  preferredLanguage: z.enum(['en', 'hi', 'kn', 'te']).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response('Expected JSON body', { status: 400 });
  }

  const parsed = PATCH_BODY.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  // 1) Persist the columns that live on User.
  const userData: { name?: string; email?: string | null } = {};
  if (body.name !== undefined) userData.name = body.name;
  if (body.email !== undefined) userData.email = body.email;

  if (Object.keys(userData).length > 0) {
    try {
      await prisma.user.update({ where: { id: session.user.id }, data: userData });
    } catch (e: unknown) {
      // Most likely a unique-constraint hit on email — surface a friendly msg.
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
        return Response.json({ error: 'That email is already in use.' }, { status: 409 });
      }
      throw e;
    }
  }

  // 2) Persist the profile prefs that live on RiderPreferences (1:1 with the
  //    rider profile). Upsert so a rider who never opened the dispatch-prefs
  //    screen still gets a row.
  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (body.emergencyPhone !== undefined || body.preferredLanguage !== undefined) {
    if (!profile) return new Response('No rider profile', { status: 404 });
    const prefData: { emergencyPhone?: string | null; preferredLanguage?: string } = {};
    if (body.emergencyPhone !== undefined) prefData.emergencyPhone = body.emergencyPhone;
    if (body.preferredLanguage !== undefined) prefData.preferredLanguage = body.preferredLanguage;
    await prisma.riderPreferences.upsert({
      where: { riderId: profile.id },
      update: prefData,
      create: { riderId: profile.id, ...prefData },
    });
  }

  // 3) Read back the persisted prefs so the client reflects committed state
  //    (not just the request echo).
  const prefs = profile
    ? await prisma.riderPreferences.findUnique({
        where: { riderId: profile.id },
        select: { emergencyPhone: true, preferredLanguage: true },
      })
    : null;

  const fresh = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  return Response.json({
    ok: true,
    profile: {
      name: fresh?.name ?? null,
      email: fresh?.email ?? null,
      emergencyPhone: prefs?.emergencyPhone ?? null,
      preferredLanguage: prefs?.preferredLanguage ?? 'en',
    },
  });
}
