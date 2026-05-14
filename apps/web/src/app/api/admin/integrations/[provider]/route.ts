import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { testAndSave, disconnect, getConfig } from '@/server/integrations';
import { PROVIDERS, ProviderKey } from '@/server/integrations/providers';
import { maskCredentials, sendIntegrationAlert } from '@/server/alerts';
import { categoryFromProvider } from '@/server/integration-categories';
import { prisma } from '@/server/db';
import { log } from '@/server/log';

const Body = z.object({ config: z.record(z.string()) });

function parseProvider(s: string): ProviderKey | null {
  return s in PROVIDERS ? (s as ProviderKey) : null;
}

function diffFields(before: Record<string, string> | null, after: Record<string, string>): Record<string, { from: string; to: string }> {
  const a = maskCredentials(before ?? {});
  const b = maskCredentials(after);
  const out: Record<string, { from: string; to: string }> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] !== b[k]) out[k] = { from: a[k] ?? '(not set)', to: b[k] ?? '(not set)' };
  }
  return out;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const p = parseProvider(provider);
  if (!p) return new Response('Unknown provider', { status: 400 });

  const session = await auth();
  const restaurant = await requireRestaurant();
  const { config } = Body.parse(await req.json());

  // Required-field validation up front
  const def = PROVIDERS[p];
  for (const f of def.fields) {
    if (f.required && !(config[f.key] && config[f.key].trim())) {
      return new Response(`Missing required field: ${f.label}`, { status: 400 });
    }
  }

  // Capture the pre-save credential view so we can diff masked values into
  // the alert email. getConfig only returns when status=CONNECTED — that's
  // fine, a fresh integration's before-state is just an empty bag.
  const before = await getConfig(restaurant.id, p).catch(() => null);

  const result = await testAndSave(restaurant.id, p, config, session?.user?.id);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error ?? 'Test failed' }, { status: 422 });
  }

  // Alert hook — fire only if at least one (masked) field differs.
  const changedFields = diffFields(before, config);
  if (Object.keys(changedFields).length > 0) {
    const cred = await prisma.integrationCredential.findUnique({
      where: { restaurantId_provider: { restaurantId: restaurant.id, provider: p as any } },
      select: { id: true }
    }).catch(() => null);

    sendIntegrationAlert({
      restaurantId: restaurant.id,
      integrationId: cred?.id ?? `${restaurant.id}:${p}`,
      provider: p,
      category: categoryFromProvider(p),
      restaurantName: restaurant.name,
      actorName: session?.user?.name ?? session?.user?.email ?? null,
      actorEmail: session?.user?.email ?? null,
      actorRole: session?.user?.role ?? 'ADMIN',
      timestamp: new Date(),
      changedFields,
      testStatus: null,
      testError: null,
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/settings#integrations`
    }).catch((e) => log.error({ err: (e as Error).message, provider: p }, 'sendIntegrationAlert(update) failed'));
  }

  return Response.json({ ok: true, detail: result.detail });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const p = parseProvider(provider);
  if (!p) return new Response('Unknown provider', { status: 400 });
  const session = await auth();
  const restaurant = await requireRestaurant();

  const before = await getConfig(restaurant.id, p).catch(() => null);
  const cred = await prisma.integrationCredential.findUnique({
    where: { restaurantId_provider: { restaurantId: restaurant.id, provider: p as any } },
    select: { id: true }
  }).catch(() => null);

  await disconnect(restaurant.id, p);

  // Alert hook — disconnect is always a meaningful change. Treat "all fields
  // dropped to (not set)" as the diff for the email body.
  if (before) {
    const changedFields: Record<string, { from: string; to: string }> = {};
    const masked = maskCredentials(before);
    for (const [k, v] of Object.entries(masked)) {
      changedFields[k] = { from: v, to: '(not set)' };
    }
    sendIntegrationAlert({
      restaurantId: restaurant.id,
      integrationId: cred?.id ?? `${restaurant.id}:${p}`,
      provider: p,
      category: categoryFromProvider(p),
      restaurantName: restaurant.name,
      actorName: session?.user?.name ?? session?.user?.email ?? null,
      actorEmail: session?.user?.email ?? null,
      actorRole: session?.user?.role ?? 'ADMIN',
      timestamp: new Date(),
      changedFields,
      testStatus: null,
      testError: null,
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/settings#integrations`
    }).catch((e) => log.error({ err: (e as Error).message, provider: p }, 'sendIntegrationAlert(disconnect) failed'));
  }

  return Response.json({ ok: true });
}
