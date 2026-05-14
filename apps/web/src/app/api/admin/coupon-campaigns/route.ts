/**
 * Coupon-campaign admin API — list + create.
 *
 *   GET  /api/admin/coupon-campaigns  — list this restaurant's campaigns (with
 *                                       their linked Offer + redemption count).
 *   POST /api/admin/coupon-campaigns  — create a campaign + the sibling Offer
 *                                       row in one transaction. The Offer is
 *                                       what the cart-side engine validates at
 *                                       checkout; the campaign owns the
 *                                       cross-channel metadata + reporting.
 *
 * Prisma client is accessed via `(prisma as any).couponCampaign` because the
 * generated client is stale relative to the schema. The Offer model is also
 * accessed through the typed client where possible.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const CampaignChannel = z.enum(['DINE_IN_TO_ONLINE', 'ONLINE_TO_DINE_IN']);
const DiscountType = z.enum(['PERCENTAGE', 'FIXED']);

const Body = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().max(1000).nullable().optional(),
  codePrefix: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .refine((v) => /^[A-Z0-9]+$/.test(v), {
      message: 'codePrefix must be uppercase alphanumeric only'
    }),
  channel: CampaignChannel,
  discountType: DiscountType,
  discountValue: z.number().positive(),
  maxDiscount: z.number().positive().nullable().optional(),
  minOrderAmount: z.number().nonnegative().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().default(1),
  distributedCount: z.number().int().nonnegative().optional(),
  validFrom: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable()
});

function buildOfferCode(prefix: string, discountType: string): string {
  if (discountType === 'PERCENTAGE') {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    return `${prefix}${suffix}`;
  }
  return prefix;
}

function channelToOfferType(c: 'DINE_IN_TO_ONLINE' | 'ONLINE_TO_DINE_IN'): string {
  return c;
}

function channelScopes(c: 'DINE_IN_TO_ONLINE' | 'ONLINE_TO_DINE_IN'): {
  issuedChannel: 'DINE_IN' | 'ONLINE';
  redeemChannel: 'DINE_IN' | 'ONLINE';
} {
  if (c === 'DINE_IN_TO_ONLINE') {
    return { issuedChannel: 'DINE_IN', redeemChannel: 'ONLINE' };
  }
  return { issuedChannel: 'ONLINE', redeemChannel: 'DINE_IN' };
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const campaigns = await (prisma as any).couponCampaign.findMany({
    where: { restaurantId: r.id },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      offers: {
        include: { _count: { select: { redemptions: true } } }
      }
    }
  });

  return Response.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const raw = await req.json().catch(() => ({}));
  // Coerce a few likely-string number fields before zod for nicer client UX
  const parsed = Body.safeParse({
    ...raw,
    discountValue: typeof raw.discountValue === 'string' ? Number(raw.discountValue) : raw.discountValue,
    maxDiscount: raw.maxDiscount === '' || raw.maxDiscount == null ? null : Number(raw.maxDiscount),
    minOrderAmount: raw.minOrderAmount === '' || raw.minOrderAmount == null ? null : Number(raw.minOrderAmount),
    maxUses: raw.maxUses === '' || raw.maxUses == null ? null : Number(raw.maxUses),
    perUserLimit: raw.perUserLimit == null ? 1 : Number(raw.perUserLimit),
    distributedCount: raw.distributedCount == null ? 0 : Number(raw.distributedCount)
  });
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Validation failed', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const data = parsed.data;

  if (data.discountType === 'PERCENTAGE' && data.discountValue > 100) {
    return new Response('Percentage discount cannot exceed 100', { status: 400 });
  }

  const scopes = channelScopes(data.channel);
  const offerCode = buildOfferCode(data.codePrefix, data.discountType);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const campaign = await (tx as any).couponCampaign.create({
        data: {
          restaurantId: r.id,
          name: data.name,
          description: data.description ?? null,
          codePrefix: data.codePrefix,
          channel: data.channel,
          discountType: data.discountType,
          discountValue: data.discountValue as any,
          maxDiscount: data.maxDiscount != null ? (data.maxDiscount as any) : null,
          minOrderAmount: data.minOrderAmount != null ? (data.minOrderAmount as any) : null,
          maxUses: data.maxUses ?? null,
          perUserLimit: data.perUserLimit,
          validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          distributedCount: data.distributedCount ?? 0,
          status: 'ACTIVE',
          createdById: session?.user?.id ?? null
        }
      });

      const offer = await (tx as any).offer.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          type: channelToOfferType(data.channel),
          code: offerCode,
          percentOff: data.discountType === 'PERCENTAGE' ? data.discountValue : null,
          flatOff: data.discountType === 'FIXED' ? (data.discountValue as any) : null,
          maxDiscount: data.maxDiscount != null ? (data.maxDiscount as any) : null,
          minOrderAmount: data.minOrderAmount != null ? (data.minOrderAmount as any) : null,
          restaurantId: r.id,
          issuedChannel: scopes.issuedChannel,
          redeemChannel: scopes.redeemChannel,
          validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
          validTo: data.expiresAt ? new Date(data.expiresAt) : null,
          usageLimit: data.maxUses ?? null,
          perUserLimit: data.perUserLimit,
          isActive: true,
          autoApply: false,
          stackable: false,
          priority: 0,
          campaignId: campaign.id,
          createdById: session?.user?.id ?? null
        }
      });

      return { campaign, offer };
    });

    await audit('campaign.create', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: r.id,
      entityType: 'CouponCampaign',
      entityId: created.campaign.id,
      after: serialise(created),
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined
    });

    return Response.json(created);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // Could be the campaign.codePrefix unique OR the Offer.code unique. Either
      // way it's a "code already in use" 409.
      return new Response('A campaign or offer with that code already exists. Pick a different prefix.', { status: 409 });
    }
    throw e;
  }
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
