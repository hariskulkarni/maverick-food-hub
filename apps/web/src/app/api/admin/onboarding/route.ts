/**
 * GET   /api/admin/onboarding  → { progress, readiness } for the active restaurant
 *                                (SUPER_ADMIN may pass ?restaurantId= to inspect any tenant).
 * PATCH /api/admin/onboarding  → save one step's state / draft / current step (restaurant ADMIN).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireManagedRestaurant } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';
import { audit } from '@/server/audit';
import { getOnboardingState, saveOnboardingStep, ProgressUpdateError } from '@/server/onboarding';
import { onboardingAdminScope, auditMeta } from '@/server/onboarding-auth';
import { ONBOARDING_STEP_KEYS } from '@/lib/onboarding/steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let restaurant;
  try {
    restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  return Response.json(await getOnboardingState(restaurant.id));
}

const StepKey = z.enum(ONBOARDING_STEP_KEYS);
const Body = z.object({
  step: StepKey,
  state: z.enum(['todo', 'done', 'skipped']).optional(),
  draft: z.unknown().optional(),
  currentStep: StepKey.optional(),
});

export async function PATCH(req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;

  try {
    const progress = await saveOnboardingStep(scope.restaurant.id, parsed);
    if (parsed.state) {
      await audit('onboarding.step.update', {
        actorId: scope.session.user.id,
        actorRole: scope.session.user.role,
        restaurantId: scope.restaurant.id,
        entityType: 'OnboardingProgress',
        entityId: scope.restaurant.id,
        after: { step: parsed.step, state: parsed.state },
        ...auditMeta(req),
      });
    }
    return Response.json({ progress });
  } catch (e) {
    if (e instanceof ProgressUpdateError) return Response.json({ error: e.message, reason: 'bad_step' }, { status: 400 });
    throw e;
  }
}
