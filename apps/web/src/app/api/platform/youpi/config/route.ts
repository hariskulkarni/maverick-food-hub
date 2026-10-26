/**
 * Super-admin: shared Flavrly PG connection (platform-level IntegrationCredential,
 * restaurantId sentinel `__platform__`). Secrets are encrypted at rest and are
 * NEVER returned — GET/POST respond with the masked summary only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { saveConfig } from '@/server/integrations';
import { ensurePlatformRestaurant } from '@/server/2fa';
import { audit } from '@/server/audit';
import { requireSuperAdmin } from '@/server/tenancy';
import { validateGatewayBaseUrl } from '@/server/pg/security';

export const dynamic = 'force-dynamic';

const PLATFORM_ID = '__platform__';

const Body = z.object({
  baseUrl: z.string().url().max(500),
  // Flavrly PG: public merchant UUID (X-Merchant-Id) + merchant key (X-Merchant-Key = webhookSecret).
  merchantId: z.string().min(1).max(500),
  webhookSecret: z.string().min(1).max(500),
  // Optional dedicated upstream merchant creation API key (never sent to browser).
  merchantKey: z.string().min(1).max(500).optional(),
  dailyLimit: z.number().int().positive().optional(),
  maxAmountPaise: z.number().int().positive().optional(),
});

async function guard() {
  try {
    return { session: await requireSuperAdmin() };
  } catch (e) {
    if (e instanceof Response) return { res: Response.json({ error: 'Forbidden' }, { status: 403 }) };
    throw e;
  }
}

async function maskedView() {
  const row = await prisma.integrationCredential.findUnique({
    where: { restaurantId_provider: { restaurantId: PLATFORM_ID, provider: 'YOUPI' as any } },
    select: { status: true, summary: true, lastTestedAt: true, updatedAt: true },
  });
  return {
    configured: !!row && row.status === 'CONNECTED',
    status: row?.status ?? 'DISCONNECTED',
    summary: row?.summary ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function GET() {
  const g = await guard();
  if (g.res) return g.res;
  return Response.json(await maskedView());
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.res) return g.res;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid body', issues: parsed.error.issues.map((i) => i.path.join('.')) }, { status: 400 });
  const d = parsed.data;
  // SSRF guard: https public host (or explicitly allowed loopback); never echoes the URL back.
  const base = await validateGatewayBaseUrl(d.baseUrl);
  if (!base.ok) return Response.json({ error: base.error, issues: ['baseUrl'] }, { status: 400 });
  const config: Record<string, string> = {
    baseUrl: base.url,
    merchantId: d.merchantId,
    webhookSecret: d.webhookSecret,
  };
  if (d.merchantKey) config.merchantKey = d.merchantKey;
  if (d.dailyLimit !== undefined) config.dailyLimit = String(d.dailyLimit);
  if (d.maxAmountPaise !== undefined) config.maxAmountPaise = String(d.maxAmountPaise);

  // Fresh DB: the sentinel Restaurant row may not exist yet (FK on IntegrationCredential).
  await ensurePlatformRestaurant();
  await saveConfig(PLATFORM_ID, 'YOUPI', config, { status: 'CONNECTED', userId: g.session!.user.id });
  await audit('integration.connect', {
    actorId: g.session!.user.id,
    actorRole: g.session!.user.role,
    entityType: 'IntegrationCredential',
    entityId: 'YOUPI',
    after: { scope: 'platform', baseUrl: config.baseUrl }, // never secrets
  });
  return Response.json(await maskedView());
}
