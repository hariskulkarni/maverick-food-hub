/**
 * PATCH /api/admin/settings/branding
 *
 * Update the signed-in restaurant's identity + media (name, tagline,
 * description, cuisine, contact, logo, cover). Restaurant ADMIN only.
 *
 * Image URL handling: the in-app ImageUploader stores files under a relative
 * path (`/uploads/restaurants/<slug>/logo/<file>.png`) when the local
 * filesystem driver is in use, and a full https URL when S3 is configured.
 * The zod schema accepts BOTH — rejecting relative paths here is what was
 * breaking the "Save branding" button after the logo was successfully
 * uploaded.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';

/** Accept either a full URL or an in-app relative path beginning with "/". */
const imageRef = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v),
    'Must be a URL or a path starting with /'
  )
  .transform((v) => (v === '' ? undefined : v));

/** Optional string — empty string collapses to undefined so we persist NULL. */
const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? undefined : v))
    .optional();

const optionalEmail = z
  .string()
  .max(254)
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email');

const Body = z.object({
  name:          z.string().trim().min(2).max(80),
  tagline:       optionalString(160),
  description:   optionalString(2000),
  cuisine:       optionalString(80),
  contactEmail:  optionalEmail,
  contactPhone:  optionalString(40),
  logoUrl:       imageRef.optional(),
  coverImageUrl: imageRef.optional(),
});

export async function PATCH(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;

  const restaurant = await requireRestaurant();

  let data;
  try {
    data = Body.parse(await req.json());
  } catch (e) {
    // Surface the first zod issue so the panel can render an actionable toast
    // instead of the generic "Save failed". The full issue list is too noisy
    // for a toast but the first one is almost always the actionable bit.
    const issue = (e as z.ZodError)?.issues?.[0];
    return Response.json(
      {
        error: issue
          ? `${issue.path.join('.') || 'field'}: ${issue.message}`
          : 'Invalid branding data — please re-check your fields and retry.',
        reason: 'bad_body',
      },
      { status: 400 }
    );
  }

  const updated = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      name: data.name,
      tagline: data.tagline ?? null,
      description: data.description ?? null,
      cuisine: data.cuisine ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      logoUrl: data.logoUrl ?? null,
      coverImageUrl: data.coverImageUrl ?? null,
    },
  });
  return Response.json(updated);
}
