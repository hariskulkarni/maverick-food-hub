/**
 * Challenges admin API — list + create. Platform-managed (SUPER_ADMIN only).
 *
 *   GET  /api/admin/challenges
 *     Lists every challenge with a derived `lifecycle` bucket (active/upcoming/expired)
 *     so the admin tabs can render without recomputing.
 *
 *   POST /api/admin/challenges
 *     Creates a new challenge. Reward fields are validated against rewardType.
 *     Writes a `challenge.create` audit row with the full after-snapshot.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const ChallengeType = z.enum(['ORDER_COUNT', 'SPEND_THRESHOLD', 'CUISINE_VARIETY', 'WEEKEND_STREAK', 'FIRST_N_ORDERS']);
const ChallengeWindow = z.enum(['LIFETIME', 'MONTHLY', 'WEEKLY', 'CUSTOM']);
const ChallengeRewardType = z.enum(['FIXED_OFF', 'PERCENT_OFF', 'FREE_DELIVERY']);

const Body = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  type: ChallengeType,
  target: z.number().int().positive().max(10_000),
  window: ChallengeWindow,
  minOrderValue: z.number().min(0).nullable().optional(),
  rewardType: ChallengeRewardType,
  rewardValue: z.number().min(0),
  rewardMaxDiscount: z.number().min(0).nullable().optional(),
  rewardValidityDays: z.number().int().min(1).max(365),
  validFrom: z.string(),
  validTo: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  perCustomerLimit: z.number().int().min(1).default(1),
  phoneVerifiedOnly: z.boolean().default(true),
  totalLimit: z.number().int().min(1).nullable().optional(),
  brandId: z.string().nullable().optional(),
  restaurantId: z.string().nullable().optional()
}).refine((d) => {
  if (d.rewardType === 'PERCENT_OFF') return d.rewardValue > 0 && d.rewardValue <= 100;
  if (d.rewardType === 'FIXED_OFF')   return d.rewardValue > 0;
  return true; // FREE_DELIVERY ignores rewardValue
}, { message: 'rewardValue does not match rewardType' });

type Lifecycle = 'active' | 'upcoming' | 'expired';

function lifecycle(c: { validFrom: Date | string; validTo: Date | string | null; isActive: boolean }, now: Date): Lifecycle {
  if (!c.isActive) return 'expired';
  const from = new Date(c.validFrom);
  if (from > now) return 'upcoming';
  if (c.validTo && new Date(c.validTo) < now) return 'expired';
  return 'active';
}

export async function GET(_req: NextRequest) {
  await requireSuperAdmin();
  const rows = await (prisma as any).challenge.findMany({
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });
  const now = new Date();
  const enriched = (rows as any[]).map((r) => ({ ...r, lifecycle: lifecycle(r, now) }));
  return Response.json({ challenges: enriched });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  await requireSuperAdmin();

  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  const created = await (prisma as any).challenge.create({
    data: {
      name: data.name.trim(),
      description: data.description ?? null,
      type: data.type,
      target: data.target,
      window: data.window,
      minOrderValue: data.minOrderValue != null ? (data.minOrderValue as any) : null,
      rewardType: data.rewardType,
      rewardValue: data.rewardValue as any,
      rewardMaxDiscount: data.rewardMaxDiscount != null ? (data.rewardMaxDiscount as any) : null,
      rewardValidityDays: data.rewardValidityDays,
      validFrom: new Date(data.validFrom),
      validTo: data.validTo ? new Date(data.validTo) : null,
      priority: data.priority ?? 0,
      isActive: data.isActive ?? true,
      perCustomerLimit: data.perCustomerLimit,
      phoneVerifiedOnly: data.phoneVerifiedOnly,
      totalLimit: data.totalLimit ?? null,
      brandId: data.brandId ?? null,
      restaurantId: data.restaurantId ?? null,
      createdById: session?.user?.id ?? null
    }
  });

  await audit('challenge.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'Challenge',
    entityId: created.id,
    after: serialise(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(created);
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
