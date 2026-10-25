/**
 * Review acquisition settings (Settings → Reviews → "Review requests" card).
 *
 *   GET → { config, googleLink, sources, whatsapp, funnel }
 *   PUT → save settings (zod-validated, audited)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { prisma } from '@/server/db';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listForRestaurant } from '@/server/integrations';
import { parseOrJsonError, optionalUrl, optionalString } from '@/server/zod-helpers';
import { funnelStats, loadAcquisitionConfig, resolveGoogleReviewUrl } from '@/server/reviews/acquisition';
import { whatsappCredsConfigured } from '@/server/reviews/review-request-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hour = z.number().int().min(0).max(23).nullable();

const Body = z.object({
  enabled: z.boolean(),
  channels: z.array(z.enum(['SMS', 'WHATSAPP', 'EMAIL'])).min(1).max(3)
    .refine((c) => new Set(c).size === c.length, 'Duplicate channel'),
  delayMinutes: z.number().int().min(0).max(7 * 24 * 60),
  quietStartHour: hour,
  quietEndHour: hour,
  reminderEnabled: z.boolean(),
  reminderAfterHours: z.number().int().min(1).max(14 * 24),
  frequencyCapDays: z.number().int().min(0).max(365),
  lowRatingThreshold: z.number().int().min(1).max(4),
  googleReviewUrlOverride: optionalUrl,
  whatsappTemplateName: optionalString(120),
  whatsappTemplateLang: optionalString(20),
}).refine((b) => (b.quietStartHour == null) === (b.quietEndHour == null), {
  message: 'Set both quiet-hours bounds or neither',
  path: ['quietEndHour'],
});

export async function GET(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const config = await loadAcquisitionConfig(restaurant.id);
    const [googleLink, funnel, integrations, places, waCreds] = await Promise.all([
      resolveGoogleReviewUrl(restaurant.id, config),
      funnelStats(restaurant.id),
      listForRestaurant(restaurant.id),
      prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId: restaurant.id }, select: { googlePlaceId: true, googlePlaceName: true } }),
      whatsappCredsConfigured(restaurant.id),
    ]);
    const gbp = integrations.find((i) => i.provider === 'GOOGLE_BUSINESS');
    return Response.json({
      config,
      googleLink,
      sources: {
        gbpConnected: gbp?.status === 'CONNECTED',
        placesConnected: !!places?.googlePlaceId,
        placesName: places?.googlePlaceName ?? null,
      },
      whatsapp: { credentialsConfigured: waCreds, templateConfigured: !!config.whatsappTemplateName },
      funnel,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const data = {
      enabled: parsed.enabled,
      channels: parsed.channels,
      delayMinutes: parsed.delayMinutes,
      quietStartHour: parsed.quietStartHour,
      quietEndHour: parsed.quietEndHour,
      reminderEnabled: parsed.reminderEnabled,
      reminderAfterHours: parsed.reminderAfterHours,
      frequencyCapDays: parsed.frequencyCapDays,
      lowRatingThreshold: parsed.lowRatingThreshold,
      googleReviewUrlOverride: parsed.googleReviewUrlOverride ?? null,
      whatsappTemplateName: parsed.whatsappTemplateName ?? null,
      whatsappTemplateLang: parsed.whatsappTemplateLang ?? null,
    };
    const before = await prisma.reviewRequestConfig.findUnique({ where: { restaurantId: restaurant.id } });
    await prisma.reviewRequestConfig.upsert({
      where: { restaurantId: restaurant.id },
      create: { restaurantId: restaurant.id, ...data },
      update: data,
    });
    const session = await auth();
    await audit('reviews.acquisition.config.update', {
      actorId: session?.user?.id ?? null,
      actorRole: session?.user?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'ReviewRequestConfig',
      entityId: restaurant.id,
      before: before ? { enabled: before.enabled, channels: before.channels, delayMinutes: before.delayMinutes } : null,
      after: data,
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
