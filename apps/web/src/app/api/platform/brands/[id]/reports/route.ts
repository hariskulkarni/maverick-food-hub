import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { getBrandSalesRollup } from '@/server/brands';
import { prisma } from '@/server/db';

const LEVELS = ['brand', 'cuisine', 'branch', 'item'] as const;
type Level = (typeof LEVELS)[number];

const Query = z.object({
  from:  z.string().datetime().optional(),
  to:    z.string().datetime().optional(),
  level: z.enum(LEVELS).optional().default('brand')
});

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_MS = 366 * MS_PER_DAY;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const url = new URL(req.url);
  const parsed = Query.parse({
    from:  url.searchParams.get('from')  ?? undefined,
    to:    url.searchParams.get('to')    ?? undefined,
    level: url.searchParams.get('level') ?? undefined
  });

  // Default range: last 30 days
  const to   = parsed.to   ? new Date(parsed.to)   : new Date();
  const from = parsed.from ? new Date(parsed.from) : new Date(to.getTime() - 30 * MS_PER_DAY);

  if (!(from < to)) {
    return Response.json({ error: 'INVALID_RANGE', message: '`from` must be earlier than `to`.' }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return Response.json({ error: 'RANGE_TOO_LARGE', message: 'Range must be ≤ 366 days.' }, { status: 400 });
  }

  const brand = await (prisma as any).brand.findUnique({ where: { id }, select: { id: true } });
  if (!brand) return new Response('Brand not found', { status: 404 });

  const rollup = await getBrandSalesRollup(id, { from, to });
  const level: Level = parsed.level;

  // Return the matching slice. `brand` returns the totals object; others
  // return their respective array.
  const slice = level === 'brand' ? rollup.brand : rollup[level];

  return Response.json({
    level,
    range: rollup.range,
    brand: rollup.brand,
    data: slice
  });
}
