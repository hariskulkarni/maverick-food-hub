import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listForRestaurant } from '@/server/integrations';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATINGS = [1, 2, 3, 4, 5];

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const all = await listForRestaurant(restaurant.id);
  // `summary` is already masked by the provider's buildSummary — never decrypt here.
  const pick = (k: string) => {
    const p = all.find((x) => x.provider === k);
    return p ? { status: p.status, summary: p.summary } : { status: 'DISCONNECTED', summary: null };
  };
  const cfg = await prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId: restaurant.id } });
  return Response.json({
    google: pick('GOOGLE_BUSINESS'),
    llm: pick('LLM_REVIEWS'),
    autoReply: cfg
      ? {
          enabled: cfg.enabled,
          autoPostMinRating: cfg.autoPostMinRating,
          draftMaxRating: cfg.draftMaxRating,
          tonePrompt: cfg.tonePrompt ?? null,
        }
      : { enabled: false, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null },
  });
}

export async function POST(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const b = await req.json().catch(() => ({}));
  const autoPostMinRating = Number(b.autoPostMinRating);
  const draftMaxRating = Number(b.draftMaxRating);
  if (!RATINGS.includes(autoPostMinRating) || !RATINGS.includes(draftMaxRating) || draftMaxRating >= autoPostMinRating) {
    return new Response('Bad thresholds', { status: 400 });
  }
  // Forward-only auto-reply: stamp enabledAt only when turning on from off.
  const current = await prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId: restaurant.id } });
  const enabled = !!b.enabled;
  const enabledAt =
    enabled && (!current || !current.enabled || !current.enabledAt) ? new Date() : (current?.enabledAt ?? null);
  const data = {
    enabled,
    enabledAt,
    autoPostMinRating,
    draftMaxRating,
    tonePrompt: typeof b.tonePrompt === 'string' && b.tonePrompt.trim() ? b.tonePrompt : null,
  };
  await prisma.reviewAutoReplyConfig.upsert({
    where: { restaurantId: restaurant.id },
    create: { restaurantId: restaurant.id, ...data },
    update: data,
  });
  return Response.json({ ok: true });
}
