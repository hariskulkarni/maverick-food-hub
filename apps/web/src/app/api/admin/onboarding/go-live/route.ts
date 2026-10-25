/**
 * POST /api/admin/onboarding/go-live
 *
 * Re-runs every readiness check server-side (the client's view is never
 * trusted). If a required check fails → 409 with the checks so the UI can
 * point at what to fix. Otherwise marks onboarding complete, makes sure the
 * restaurant has its storefront QR, and audits.
 *
 * Customer visibility itself is still governed by Restaurant.status, which
 * only a super-admin changes (approval) — this route never touches it.
 */
import { NextRequest } from 'next/server';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import { goLive } from '@/server/onboarding';
import { onboardingAdminScope, auditMeta } from '@/server/onboarding-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;

  const result = await goLive(scope.restaurant.id);
  if (!result.ok) {
    return Response.json(
      { error: `${result.readiness.requiredFailing} required item(s) still need attention.`, reason: 'not_ready', readiness: result.readiness },
      { status: 409 },
    );
  }
  if (!result.alreadyLive) {
    try {
      const { ensureRestaurantQr } = await import('@/server/qr');
      await ensureRestaurantQr(scope.restaurant.id);
    } catch (err) {
      log.error({ err, restaurantId: scope.restaurant.id }, 'onboarding go-live: QR mint failed');
    }
    await audit('onboarding.go_live', {
      actorId: scope.session.user.id,
      actorRole: scope.session.user.role,
      restaurantId: scope.restaurant.id,
      entityType: 'OnboardingProgress',
      entityId: scope.restaurant.id,
      after: { completedAt: result.progress.completedAt, checks: result.readiness.checks.map((c) => `${c.key}:${c.ok ? 'ok' : 'warn'}`) },
      ...auditMeta(req),
    });
  }
  return Response.json({ progress: result.progress, readiness: result.readiness, alreadyLive: result.alreadyLive, status: scope.restaurant.status });
}
