/** POST /api/admin/onboarding/dismiss — hide the dashboard setup checklist (only once setup is complete). */
import { NextRequest } from 'next/server';
import { dismissChecklist, ProgressUpdateError } from '@/server/onboarding';
import { onboardingAdminScope } from '@/server/onboarding-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json({ progress: await dismissChecklist(scope.restaurant.id) });
  } catch (e) {
    if (e instanceof ProgressUpdateError) return Response.json({ error: e.message, reason: 'not_complete' }, { status: 409 });
    throw e;
  }
}
