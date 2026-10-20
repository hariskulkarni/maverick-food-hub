import { requireManagedRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { getConfig, saveConfig } from '@/server/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VPA_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** Save the restaurant's receiving UPI VPA. Only once super-admin has APPROVED the feature. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let restaurant;
  try {
    restaurant = await requireManagedRestaurant(body?.restaurantId ?? null);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id } });
  if (fr?.status !== 'APPROVED') {
    return Response.json({ error: 'YouPI is not approved for this restaurant' }, { status: 403 });
  }
  const receivingVpa = typeof body?.receivingVpa === 'string' ? body.receivingVpa.trim() : '';
  if (!VPA_RE.test(receivingVpa)) {
    return Response.json({ error: 'Enter a valid UPI ID like name@bank' }, { status: 400 });
  }
  const existing = (await getConfig(restaurant.id, 'YOUPI')) ?? {};
  await saveConfig(restaurant.id, 'YOUPI', { ...existing, receivingVpa }, { status: 'CONNECTED' });
  return Response.json({ ok: true });
}
