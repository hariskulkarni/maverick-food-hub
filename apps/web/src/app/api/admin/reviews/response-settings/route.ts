import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { tenantAdminOrError } from '@/server/tenancy';
import { getResponseSettings } from '@/server/reviews/store';
import { auditReview } from '@/server/reviews/review-audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dto(s: Awaited<ReturnType<typeof getResponseSettings>>) {
  return {
    skipKeywords: s.skipKeywords,
    brandVoiceSummary: s.brandVoiceSummary, brandVoiceUpdatedAt: s.brandVoiceUpdatedAt,
    alertEnabled: s.alertEnabled, alertMaxRating: s.alertMaxRating, alertSms: s.alertSms, alertWhatsapp: s.alertWhatsapp,
    slaHours: s.slaHours, escalationEmail: s.escalationEmail, escalationPhone: s.escalationPhone,
    digestEnabled: s.digestEnabled, digestSms: s.digestSms, digestWhatsapp: s.digestWhatsapp, digestLastSentAt: s.digestLastSentAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    return Response.json(dto(await getResponseSettings(restaurant.id)));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const Body = z.object({
  skipKeywords: z.array(z.string().trim().min(2).max(40)).max(40).optional(),
  alertEnabled: z.boolean().optional(),
  alertMaxRating: z.number().int().min(1).max(4).optional(),
  alertSms: z.boolean().optional(),
  alertWhatsapp: z.boolean().optional(),
  slaHours: z.number().int().min(1).max(168).optional(),
  escalationEmail: z.preprocess(emptyToNull, z.string().trim().email().max(200).nullable()).optional(),
  escalationPhone: z.preprocess(emptyToNull, z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Invalid phone').nullable()).optional(),
  digestEnabled: z.boolean().optional(),
  digestSms: z.boolean().optional(),
  digestWhatsapp: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
    if (parsed instanceof Response) return parsed;
    const data = { ...parsed };
    if (data.skipKeywords) data.skipKeywords = [...new Set(data.skipKeywords.map((k) => k.toLowerCase()))];
    const before = dto(await getResponseSettings(restaurant.id));
    const row = await prisma.reviewResponseSettings.upsert({
      where: { restaurantId: restaurant.id }, create: { restaurantId: restaurant.id, ...data }, update: data,
    });
    await auditReview('reviews.settings.update', restaurant.id, { entityType: 'ReviewResponseSettings', before, after: data });
    return Response.json(dto(row));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
