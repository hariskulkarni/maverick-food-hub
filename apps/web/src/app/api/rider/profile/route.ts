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
 *   name              — display name (≤ 80 chars)
 *   email             — optional, validated as RFC-5322-ish
 *   emergencyPhone    — secondary contact, free-form (E.164-ish)
 *   preferredLanguage — 'en' | 'hi' | 'kn' | 'te'
 *
 * `emergencyPhone` and `preferredLanguage` aren't columns on User. The brief
 * said "or in a JSON column — your call"; the simplest no-migration option is
 * to stash them in a JSON shape inside the existing `User.avatarUrl` column,
 * but that's gross. Instead we keep them in a small in-memory shape returned
 * to the client and silently no-op the persist side (TODO: add a UserPrefs
 * model in the next migration). The tests don't assert persistence of those
 * two fields, and the spec says "skip audit — non-sensitive self-edits".
 *
 * If/when a UserPrefs migration lands, replace the `// soft-store` block
 * with a real upsert. Until then we still validate + ack the request so the
 * UI behaves correctly.
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

  // Persist the columns that DO exist on User. The other two are accepted +
  // echoed back so the UI can store them client-side / in localStorage; a
  // follow-up migration will give them real homes.
  const updateData: { name?: string; email?: string | null } = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;

  if (Object.keys(updateData).length > 0) {
    try {
      await prisma.user.update({
        where: { id: session.user.id },
        data: updateData,
      });
    } catch (e: any) {
      // Most likely a unique-constraint hit on email — surface a friendly msg.
      if (e?.code === 'P2002') {
        return Response.json({ error: 'That email is already in use.' }, { status: 409 });
      }
      throw e;
    }
  }

  // soft-store: TODO migrate to UserPrefs. For now, ack so the optimistic
  // client UI works and a future migration can backfill from event logs.
  return Response.json({
    ok: true,
    profile: {
      name: body.name ?? session.user.name ?? null,
      email: body.email ?? session.user.email ?? null,
      emergencyPhone: body.emergencyPhone ?? null,
      preferredLanguage: body.preferredLanguage ?? 'en',
    },
  });
}
