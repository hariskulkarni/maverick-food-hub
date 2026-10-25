/**
 * Resolve the caller of a training route into a `Learner`, or a Response the
 * route must return. Riders authenticate via rider-auth (Bearer token or
 * cookie); restaurant staff (KITCHEN / ADMIN) via the web session and must be
 * linked to a restaurant.
 */
import { prisma } from '@/server/db';
import { auth as riderAuth } from '@/server/rider-auth';
import { auth } from '@/server/auth';
import { forbidden, unauthenticated } from '@/server/api-auth';
import { currentRestaurant } from '@/server/tenancy';
import { normalizeLang } from './content';
import type { Learner } from './service';
import type { TrainingLanguage } from './types';

export async function riderLearner(langParam: string | null): Promise<{ learner: Learner; lang: TrainingLanguage } | Response> {
  const session = await riderAuth();
  // Same status the pre-v2 rider routes returned, so old app builds behave identically.
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      createdAt: true,
      riderProfile: { select: { id: true, preferences: { select: { preferredLanguage: true } } } },
    },
  });
  if (!user?.riderProfile) return new Response('No rider profile', { status: 404 });
  const lang = normalizeLang(langParam ?? user.riderProfile.preferences?.preferredLanguage ?? 'en');
  return { learner: { id: user.id, role: user.role, createdAt: user.createdAt }, lang };
}

export async function staffLearner(
  langParam: string | null,
): Promise<{ learner: Learner; lang: TrainingLanguage; restaurantId: string } | Response> {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const role = session.user.role;
  if (role !== 'KITCHEN' && role !== 'ADMIN') return forbidden('Training is available to restaurant staff accounts.');
  const restaurant = await currentRestaurant();
  if (!restaurant) return forbidden('Your account is not linked to a restaurant yet.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, createdAt: true } });
  if (!user) return unauthenticated();
  return { learner: { id: user.id, role: user.role, createdAt: user.createdAt }, lang: normalizeLang(langParam), restaurantId: restaurant.id };
}

/** Map a service result that may be an action error onto a Response. */
export function actionResponse(result: unknown, okStatus = 200): Response {
  if (result && typeof result === 'object' && 'error' in result && 'status' in result) {
    const { status, ...body } = result as { status: number; error: string };
    return Response.json(body, { status });
  }
  return Response.json(result, { status: okStatus });
}
