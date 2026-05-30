/**
 * Single Challenge admin API. SUPER_ADMIN only.
 *
 *   GET    /api/admin/challenges/[id]
 *     Returns the challenge plus three counters:
 *       totalIssued        — ChallengeReward rows
 *       completedCount     — ChallengeProgress with completed=true
 *       activeProgressCount — ChallengeProgress with completed=false
 *
 *   PATCH  /api/admin/challenges/[id]
 *     All-optional partial update. Writes `challenge.update` audit.
 *
 *   DELETE /api/admin/challenges/[id]
 *     Soft-delete (isActive=false). Writes `challenge.deactivate` audit.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { optionalString, parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const ChallengeType = z.enum(['ORDER_COUNT', 'SPEND_THRESHOLD', 'CUISINE_VARIETY', 'WEEKEND_STREAK', 'FIRST_N_ORDERS']);
const ChallengeWindow = z.enum(['LIFETIME', 'MONTHLY', 'WEEKLY', 'CUSTOM']);
const ChallengeRewardType = z.enum(['FIXED_OFF', 'PERCENT_OFF', 'FREE_DELIVERY']);

const Patch = z.object({
  name: optionalString(200),
  description: z.string().max(2000).nullable().optional(),
  type: ChallengeType.optional(),
  target: z.number().int().positive().max(10_000).optional(),
  window: ChallengeWindow.optional(),
  minOrderValue: z.number().min(0).nullable().optional(),
  rewardType: ChallengeRewardType.optional(),
  rewardValue: z.number().min(0).optional(),
  rewardMaxDiscount: z.number().min(0).nullable().optional(),
  rewardValidityDays: z.number().int().min(1).max(365).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  perCustomerLimit: z.number().int().min(1).optional(),
  phoneVerifiedOnly: z.boolean().optional(),
  totalLimit: z.number().int().min(1).nullable().optional(),
  brandId: z.string().nullable().optional(),
  restaurantId: z.string().nullable().optional()
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const challenge = await (prisma as any).challenge.findUnique({ where: { id } });
  if (!challenge) return new Response('Not found', { status: 404 });

  const [totalIssued, completedCount, activeProgressCount] = await Promise.all([
    (prisma as any).challengeReward.count({ where: { challengeId: id } }),
    (prisma as any).challengeProgress.count({ where: { challengeId: id, completed: true } }),
    (prisma as any).challengeProgress.count({ where: { challengeId: id, completed: false } })
  ]);

  return Response.json({
    ...challenge,
    counters: { totalIssued, completedCount, activeProgressCount }
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  await requireSuperAdmin();
  const { id } = await params;

  const before = await (prisma as any).challenge.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const parsed = parseOrJsonError(Patch, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.description !== undefined) patch.description = data.description;
  if (data.type !== undefined) patch.type = data.type;
  if (data.target !== undefined) patch.target = data.target;
  if (data.window !== undefined) patch.window = data.window;
  if (data.minOrderValue !== undefined) patch.minOrderValue = data.minOrderValue != null ? (data.minOrderValue as any) : null;
  if (data.rewardType !== undefined) {
    patch.rewardType = data.rewardType;
    // Reset maxDiscount when rewardType is not PERCENT_OFF so stale data doesn't leak.
    if (data.rewardType !== 'PERCENT_OFF') patch.rewardMaxDiscount = null;
  }
  if (data.rewardValue !== undefined) patch.rewardValue = data.rewardValue as any;
  if (data.rewardMaxDiscount !== undefined) patch.rewardMaxDiscount = data.rewardMaxDiscount != null ? (data.rewardMaxDiscount as any) : null;
  if (data.rewardValidityDays !== undefined) patch.rewardValidityDays = data.rewardValidityDays;
  if (data.validFrom !== undefined) patch.validFrom = new Date(data.validFrom);
  if (data.validTo !== undefined) patch.validTo = data.validTo ? new Date(data.validTo) : null;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  if (data.perCustomerLimit !== undefined) patch.perCustomerLimit = data.perCustomerLimit;
  if (data.phoneVerifiedOnly !== undefined) patch.phoneVerifiedOnly = data.phoneVerifiedOnly;
  if (data.totalLimit !== undefined) patch.totalLimit = data.totalLimit ?? null;
  if (data.brandId !== undefined) patch.brandId = data.brandId ?? null;
  if (data.restaurantId !== undefined) patch.restaurantId = data.restaurantId ?? null;
  patch.updatedById = session?.user?.id ?? null;

  const updated = await (prisma as any).challenge.update({ where: { id }, data: patch });

  await audit('challenge.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'Challenge',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  await requireSuperAdmin();
  const { id } = await params;

  const before = await (prisma as any).challenge.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const updated = await (prisma as any).challenge.update({
    where: { id },
    data: { isActive: false, updatedById: session?.user?.id ?? null }
  });

  await audit('challenge.deactivate', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'Challenge',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true });
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
