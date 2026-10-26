/**
 * Auth + tenancy for the /api/admin/onboarding/* write routes: a restaurant
 * ADMIN session, scoped to their active restaurant (requireRestaurant honours
 * the switcher cookie only for restaurants they can access). Never throws —
 * returns a Response the route must return as-is.
 */
import type { Session } from 'next-auth';
import { requireRestaurantAdminApi } from './api-auth';
import { requireRestaurant } from './tenancy';
import { clientIp } from './http/rate-limit';

type Restaurant = Awaited<ReturnType<typeof requireRestaurant>>;

export async function onboardingAdminScope(): Promise<{ session: Session; restaurant: Restaurant } | Response> {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  try {
    return { session: gate as Session, restaurant: await requireRestaurant() };
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export function auditMeta(req: Request) {
  return { ipAddress: clientIp(req), userAgent: req.headers.get('user-agent') };
}
