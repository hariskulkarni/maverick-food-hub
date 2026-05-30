import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';
import { parseOrJsonError } from '@/server/zod-helpers';

const Body = z.object({
  name: z.string().min(2),
  notes: z.string().optional().or(z.literal('').transform(() => undefined)),

  // base & distance
  baseAmount:              z.number().min(0),
  perKmAmount:             z.number().min(0),
  firstKmIncluded:         z.number().min(0).default(1),
  longDistanceThresholdKm: z.number().min(0).default(5),
  longDistanceBonusPerKm:  z.number().min(0).default(0),

  // time-based
  perMinuteAmount:    z.number().min(0).default(0),
  lunchPeakStartMin:  z.number().int().min(0).max(1440).default(720),
  lunchPeakEndMin:    z.number().int().min(0).max(1440).default(870),
  lunchPeakBonus:     z.number().min(0).default(10),
  dinnerPeakStartMin: z.number().int().min(0).max(1440).default(1140),
  dinnerPeakEndMin:   z.number().int().min(0).max(1440).default(1380),
  dinnerPeakBonus:    z.number().min(0).default(10),
  lateNightStartMin:  z.number().int().min(0).max(1440).default(1320),
  lateNightBonus:     z.number().min(0).default(0),
  weekendBonus:       z.number().min(0).default(0),

  // conditions
  rainBonus:          z.number().min(0).default(15),
  codHandlingFee:     z.number().min(0).default(0),
  orderValueSharePct: z.number().min(0).max(100).default(0),

  // performance
  dailyTripBonusThreshold:  z.number().int().min(0).default(0),
  dailyTripBonusAmount:     z.number().min(0).default(0),
  weeklyTripBonusThreshold: z.number().int().min(0).default(0),
  weeklyTripBonusAmount:    z.number().min(0).default(0),
  ratingBonusThreshold:     z.number().min(0).max(5).default(0),
  ratingBonusAmount:        z.number().min(0).default(0),

  // wait time & cancellation
  waitTimeStartMin:   z.number().int().min(0).default(10),
  waitTimePerMin:     z.number().min(0).default(1),
  cancellationPayPct: z.number().int().min(0).max(100).default(50),

  // caps
  minimumPerDelivery: z.number().min(0).default(0),
  maxPerDelivery:     z.number().min(0).default(0),

  // schedule
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo:   z.string().datetime().optional().nullable()
});

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const session = await auth();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  // Snapshot the rule being superseded (for the audit trail).
  const prevActive = await prisma.deliveryPayoutRule.findFirst({ where: { isActive: true }, select: { id: true, name: true } });

  // De-activate current rule(s)
  await prisma.deliveryPayoutRule.updateMany({ where: { isActive: true }, data: { isActive: false, effectiveTo: new Date() } });

  const rule = await prisma.deliveryPayoutRule.create({
    data: {
      ...data,
      // decimals
      baseAmount: data.baseAmount as any,
      perKmAmount: data.perKmAmount as any,
      firstKmIncluded: data.firstKmIncluded as any,
      longDistanceThresholdKm: data.longDistanceThresholdKm as any,
      longDistanceBonusPerKm: data.longDistanceBonusPerKm as any,
      perMinuteAmount: data.perMinuteAmount as any,
      lunchPeakBonus: data.lunchPeakBonus as any,
      dinnerPeakBonus: data.dinnerPeakBonus as any,
      lateNightBonus: data.lateNightBonus as any,
      weekendBonus: data.weekendBonus as any,
      rainBonus: data.rainBonus as any,
      codHandlingFee: data.codHandlingFee as any,
      dailyTripBonusAmount: data.dailyTripBonusAmount as any,
      weeklyTripBonusAmount: data.weeklyTripBonusAmount as any,
      ratingBonusAmount: data.ratingBonusAmount as any,
      waitTimePerMin: data.waitTimePerMin as any,
      minimumPerDelivery: data.minimumPerDelivery as any,
      maxPerDelivery: data.maxPerDelivery as any,
      isActive: true,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null
    }
  });

  await audit('payout.rule.publish', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'DeliveryPayoutRule',
    entityId: rule.id,
    before: prevActive ? { id: prevActive.id, name: prevActive.name } : null,
    after: { id: rule.id, name: rule.name, baseAmount: data.baseAmount, perKmAmount: data.perKmAmount },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json(rule);
}
