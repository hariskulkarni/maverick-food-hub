import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { testConfig } from '@/server/integrations';
import { PROVIDERS, ProviderKey } from '@/server/integrations/providers';
import { sendIntegrationAlert } from '@/server/alerts';
import { categoryFromProvider } from '@/server/integration-categories';
import { prisma } from '@/server/db';
import { log } from '@/server/log';

const Body = z.object({ config: z.record(z.string()) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!(provider in PROVIDERS)) return new Response('Unknown provider', { status: 400 });
  const session = await auth();
  const restaurant = await requireRestaurant(); // auth gate only — we don't persist on /test
  const { config } = Body.parse(await req.json());
  const def = PROVIDERS[provider as ProviderKey];
  for (const f of def.fields) {
    if (f.required && !(config[f.key] && config[f.key].trim())) {
      return Response.json({ ok: false, error: `Missing required field: ${f.label}` }, { status: 400 });
    }
  }
  const result = await testConfig(provider as ProviderKey, config);

  // Alert hook — every test invocation fires (debouncing handled by the
  // dispatcher). changedFields is empty for a test-only invocation.
  const cred = await prisma.integrationCredential.findUnique({
    where: { restaurantId_provider: { restaurantId: restaurant.id, provider: provider as any } },
    select: { id: true }
  }).catch(() => null);

  sendIntegrationAlert({
    restaurantId: restaurant.id,
    integrationId: cred?.id ?? `${restaurant.id}:${provider}`,
    provider,
    category: categoryFromProvider(provider),
    restaurantName: restaurant.name,
    actorName: session?.user?.name ?? session?.user?.email ?? null,
    actorEmail: session?.user?.email ?? null,
    actorRole: session?.user?.role ?? 'ADMIN',
    timestamp: new Date(),
    changedFields: {},
    testStatus: result.ok ? 'pass' : 'fail',
    testError: result.ok ? null : (result.error ?? null),
    detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/settings#integrations`
  }).catch((e) => log.error({ err: (e as Error).message, provider }, 'sendIntegrationAlert(test) failed'));

  return Response.json(result);
}
