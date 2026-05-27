/**
 * PATCH /api/admin/storefront — save the restaurant's storefront CMS config.
 * The whole config blob is sanitised through parseStorefrontConfig before
 * persisting, so a malformed/oversized payload can never corrupt rendering.
 */
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';
import { parseStorefrontConfig } from '@/server/storefront-cms';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const session = await auth();
  const body = await req.json().catch(() => ({}));
  const config = parseStorefrontConfig(body?.config ?? body);
  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: { storefrontConfig: config as object },
  });
  // Bust the public storefront's cache so the change shows immediately.
  try { revalidatePath(`/r/${restaurant.slug}`); } catch { /* best-effort */ }
  await audit('restaurant.settings.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: restaurant.id,
    entityType: 'Restaurant',
    entityId: restaurant.id,
    after: {
      storefront: 'updated',
      heroType: config.hero.type,
      slides: config.hero.slides.length,
      blocks: config.blocks.length,
      announcement: config.announcement.enabled,
      about: config.about.enabled,
      fontPair: config.theme.fontPair,
    },
  }).catch(() => {});
  return Response.json({ ok: true, config });
}
