/**
 * Single-campaign admin API.
 *
 *   GET    /api/admin/coupon-campaigns/[id]
 *     → campaign + linked Offer + redemption counters (count, total amount off).
 *   PATCH  /api/admin/coupon-campaigns/[id]
 *     → non-destructive edits: name, description, distributedCount, status.
 *       Status transitions (ACTIVE↔PAUSED, etc.) also flip the linked Offer's
 *       isActive so the cart engine respects the campaign's lifecycle.
 *   DELETE /api/admin/coupon-campaigns/[id]
 *     → soft delete: status=PAUSED + linked Offer.isActive=false.
 *
 * Every mutation writes an audit log entry with before/after snapshots.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit, type AuditAction } from '@/server/audit';
import { optionalString, parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const Patch = z.object({
  name: optionalString(200),
  description: z.string().max(1000).nullable().optional(),
  distributedCount: z.number().int().nonnegative().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED']).optional()
});

async function fetchOwned(id: string, restaurantId: string) {
  return (prisma as any).couponCampaign.findFirst({
    where: { id, restaurantId },
    include: { offers: true }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await requireRestaurant();
  const { id } = await params;

  const campaign = await fetchOwned(id, r.id);
  if (!campaign) return Response.json({ error: 'Campaign not found', reason: 'not_found' }, { status: 404 });

  const offerIds: string[] = (campaign.offers ?? []).map((o: any) => o.id);

  let redeemed = 0;
  let totalAmountOff = 0;
  if (offerIds.length > 0) {
    const agg = await (prisma as any).offerRedemption.aggregate({
      where: { offerId: { in: offerIds } },
      _count: { _all: true },
      _sum: { amountOff: true }
    });
    redeemed = agg._count?._all ?? 0;
    totalAmountOff = Number(agg._sum?.amountOff ?? 0);
  }

  return Response.json({
    campaign,
    redemption: {
      redeemed,
      totalAmountOff
    }
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return Response.json({ error: 'Campaign not found', reason: 'not_found' }, { status: 404 });

  const parsed = parseOrJsonError(Patch, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  const patch: any = { updatedById: session?.user?.id ?? null };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.distributedCount !== undefined) patch.distributedCount = data.distributedCount;
  if (data.status !== undefined) patch.status = data.status;

  // Decide on the audit action — pause/resume gets its own verb when status flips.
  let action: AuditAction = 'campaign.update';
  if (data.status && data.status !== before.status) {
    if (data.status === 'PAUSED') action = 'campaign.pause';
    else if (data.status === 'ACTIVE' && before.status === 'PAUSED') action = 'campaign.resume';
  }

  const updated = await prisma.$transaction(async (tx) => {
    await (tx as any).couponCampaign.update({ where: { id }, data: patch });

    // Mirror status onto the linked Offer's isActive so the cart engine respects it.
    if (data.status !== undefined && before.offers?.length) {
      const shouldBeActive = data.status === 'ACTIVE';
      await (tx as any).offer.updateMany({
        where: { campaignId: id },
        data: { isActive: shouldBeActive, updatedById: session?.user?.id ?? null }
      });
    }

    return (tx as any).couponCampaign.findUnique({
      where: { id },
      include: { offers: true }
    });
  });

  await audit(action, {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'CouponCampaign',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return Response.json({ error: 'Campaign not found', reason: 'not_found' }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    await (tx as any).couponCampaign.update({
      where: { id },
      data: { status: 'PAUSED', updatedById: session?.user?.id ?? null }
    });
    await (tx as any).offer.updateMany({
      where: { campaignId: id },
      data: { isActive: false, updatedById: session?.user?.id ?? null }
    });
    return (tx as any).couponCampaign.findUnique({
      where: { id },
      include: { offers: true }
    });
  });

  await audit('campaign.pause', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'CouponCampaign',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json({ ok: true });
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
