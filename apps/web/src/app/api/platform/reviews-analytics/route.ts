/**
 * GET /api/platform/reviews-analytics?days=30
 * SUPER_ADMIN-only, read-only aggregate of in-app feedback + Google reviews.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { loadReviewsAnalytics } from '@/server/reviews-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const raw = Number(new URL(req.url).searchParams.get('days') ?? 30);
  const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 365) : 30;
  return Response.json(await loadReviewsAnalytics(days));
}
