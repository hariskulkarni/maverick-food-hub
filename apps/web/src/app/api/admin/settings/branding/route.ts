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
import {
  imageRef,
  optionalString,
  optionalEmail,
  optionalPhone,
  parseOrJsonError,
} from '@/server/zod-helpers';

const Body = z.object({
  name:          z.string().trim().min(2).max(80),
  tagline:       optionalString(160),
  description:   optionalString(2000),
  cuisine:       optionalString(80),
  contactEmail:  optionalEmail,
  contactPhone:  optionalPhone,
  logoUrl:       imageRef.optional(),
  coverImageUrl: imageRef.optional(),
});

export async function PATCH(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;

  const restaurant = await requireRestaurant();

  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

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
