/**
 * POST /api/platform/payouts/preview
 * Body: { rule: <DeliveryPayoutRule shape>, scenarios: CalcContext[] }
 * Runs each scenario through `computeFromRule` and returns the breakdowns.
 * Used by the editor's live calculator so admins see the actual numbers their
 * rule will produce before saving.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { computeFromRule } from '@/server/payouts';
import { parseOrJsonError } from '@/server/zod-helpers';

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
  waitMinutes: z.number().min(0).default(0),
  riderTripsTodayBeforeThis: z.number().int().min(0).default(0),
  riderTripsThisWeekBeforeThis: z.number().int().min(0).default(0),
  riderRating: z.number().min(0).max(5).default(4.6),
  cancelled: z.boolean().default(false)
});

const Body = z.object({
  rule: z.record(z.any()),
  scenarios: z.array(Scenario).min(1).max(10)
});

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  // Construct a Date from hour/minute/dayOfWeek for placedAt
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay()); // Sunday = 0
  const results = data.scenarios.map((s) => {
    const placedAt = new Date(monday);
    placedAt.setDate(monday.getDate() + s.dayOfWeek);
    placedAt.setHours(s.hour, s.minute, 0, 0);
    return {
      label: s.label,
      breakdown: computeFromRule(data.rule, {
        distanceKm: s.distanceKm,
        placedAt,
        subtotal: s.subtotal,
        paymentMethod: s.paymentMethod,
        rainActive: s.rainActive,
        activeMinutes: s.activeMinutes,
        waitMinutes: s.waitMinutes,
        riderTripsTodayBeforeThis: s.riderTripsTodayBeforeThis,
        riderTripsThisWeekBeforeThis: s.riderTripsThisWeekBeforeThis,
        riderRating: s.riderRating,
        cancelled: s.cancelled
      })
    };
  });
  return Response.json({ results });
}
