/**
 * POST /api/platform/riders/[id]/payout-override/preview
 * Body:
 *   {
 *     draft: { basePay?, perKmRate?, minPayout?, maxPayout?, codHandlingFee? },
 *     scenarios: CalcContext[]
 *   }
 *
 * For each scenario we return TWO breakdowns:
 *   - `platform`: scenario run through the platform DeliveryPayoutRule alone
 *   - `withOverride`: scenario run through (platformRule ⊕ draftOverride)
 *
 * This lets the editor render a side-by-side diff ("rider would earn ₹X more
 * per trip") before the admin commits.
 *
 * Note: this is read-only — nothing is persisted. No audit log entry.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { computeFromRule, mergeRule } from '@/server/payouts';
import { parseOrJsonError } from '@/server/zod-helpers';

const Money = z.number().min(0).max(100_000).nullish();
const Draft = z.object({
  basePay:        Money,
  perKmRate:      Money,
  minPayout:      Money,
  maxPayout:      Money,
  codHandlingFee: Money
});

const Scenario = z.object({
  label: z.string().optional(),
  distanceKm: z.number().min(0).default(3),
  hour: z.number().int().min(0).max(23).default(13),
  minute: z.number().int().min(0).max(59).default(0),
  dayOfWeek: z.number().int().min(0).max(6).default(3),
  subtotal: z.number().min(0).default(400),
  paymentMethod: z.string().default('RAZORPAY'),
  rainActive: z.boolean().default(false),
  activeMinutes: z.number().min(0).default(0),
  waitMinutes: z.number().min(0).default(0)
});

const Body = z.object({
  draft: Draft,
  scenarios: z.array(Scenario).min(1).max(10)
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  // Anchor: the active platform rule. Override is purely additive on top.
  const platformRule = await prisma.deliveryPayoutRule.findFirst({
    where: { isActive: true, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
    orderBy: { effectiveFrom: 'desc' }
  });

  const overrideRule = mergeRule(platformRule, data.draft);

  // Build placedAt for each scenario from (dayOfWeek, hour, minute).
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay());

  const results = data.scenarios.map((s) => {
    const placedAt = new Date(monday);
    placedAt.setDate(monday.getDate() + s.dayOfWeek);
    placedAt.setHours(s.hour, s.minute, 0, 0);
    const ctx = {
      distanceKm: s.distanceKm,
      placedAt,
      subtotal: s.subtotal,
      paymentMethod: s.paymentMethod,
      rainActive: s.rainActive,
      activeMinutes: s.activeMinutes,
      waitMinutes: s.waitMinutes
    };
    const platform     = computeFromRule(platformRule, ctx);
    const withOverride = computeFromRule(overrideRule, ctx);
    return {
      label: s.label,
      platform,
      withOverride,
      delta: +(withOverride.payout - platform.payout).toFixed(2)
    };
  });

  // Rider id is informational — used by audit-trace if we ever surface "who
  // previewed what". For now we just echo it back so the client can sanity-check.
  return Response.json({ riderId: id, results });
}
