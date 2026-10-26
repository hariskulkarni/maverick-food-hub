/**
 * Novaryq admin surface (restaurant ADMIN of the active restaurant only).
 *
 * `novaryqAdminGate()` is the single authorization point for every
 * /api/admin/integrations/novaryq/* route: membership ADMIN via tenantAdminOrError
 * WITHOUT an explicit restaurantId, so a SUPER_ADMIN cannot target a tenant here
 * (they get the read-only /platform/novaryq page) and KITCHEN members get 403.
 * Writes additionally need the platform flag.
 */
import { prisma } from '../db';
import { auth } from '../auth';
import { audit } from '../audit';
import { brand } from '@/lib/brand';
import { decryptJSON } from '../crypto';
import { tenantAdminOrError } from '../tenancy';
import { disconnect, testAndSave } from '../integrations';
import { NovaryqApiError, checkBaseUrl, normalizeBaseUrl } from './client';
import { novaryqFlagOn, novaryqWebhookUrl, parseNovaryqConfig, serializeNovaryqConfig, type NovaryqConfig } from './config';
import { checkLocationCurrency, testNovaryqConnection } from './menu';

export const NOVARYQ_WEBHOOK_EVENTS = ['order.status_changed', 'menu.item.availability_changed'];

export interface AdminContext { restaurantId: string; restaurantName: string; userId: string }

export async function novaryqAdminGate(opts: { write?: boolean } = {}): Promise<AdminContext | Response> {
  const restaurant = await tenantAdminOrError(null);
  if (restaurant instanceof Response) return restaurant;
  if (opts.write && !novaryqFlagOn()) {
    return Response.json({ error: 'The Novaryq integration is not enabled on this platform yet.' }, { status: 403 });
  }
  const session = await auth();
  return { restaurantId: restaurant.id, restaurantName: restaurant.name, userId: session?.user?.id ?? '' };
}

/** Maps library errors to a JSON response: Novaryq failures → 502, everything else → 422. */
export function adminError(e: unknown): Response {
  if (e instanceof NovaryqApiError) return Response.json({ error: e.message }, { status: 502 });
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
}

/** Stored config regardless of the last test outcome (getConfig hides FAILED rows). */
async function storedConfig(restaurantId: string): Promise<NovaryqConfig | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { restaurantId_provider: { restaurantId, provider: 'NOVARYQ' } },
    select: { configEncrypted: true },
  });
  if (!row) return null;
  try {
    return parseNovaryqConfig(decryptJSON<Record<string, string>>(row.configEncrypted));
  } catch {
    return null;
  }
}

export type Health = 'off' | 'not_connected' | 'healthy' | 'degraded' | 'failing';

export async function novaryqOverview(restaurantId: string) {
  const [cred, branches, counts, retrying, lastWebhook] = await Promise.all([
    prisma.integrationCredential.findUnique({
      where: { restaurantId_provider: { restaurantId, provider: 'NOVARYQ' } },
      select: { status: true, summary: true, lastTestedAt: true, lastError: true },
    }),
    prisma.branch.findMany({
      where: { restaurantId },
      select: { id: true, name: true, isActive: true, novaryqLink: { select: { novaryqLocationId: true, currency: true, updatedAt: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.novaryqOrderSync.groupBy({ by: ['state'], where: { restaurantId }, _count: { _all: true } }),
    prisma.novaryqOrderSync.count({ where: { restaurantId, state: { in: ['PENDING', 'CANCEL_PENDING'] }, attempts: { gt: 1 } } }),
    prisma.novaryqWebhookEvent.findFirst({ where: { restaurantId }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true, event: true } }),
  ]);
  const byState = Object.fromEntries(counts.map((c) => [c.state, c._count._all])) as Record<string, number>;
  const summary = (cred?.summary ?? null) as { enabled?: boolean } | null;
  const enabled = !!summary?.enabled;
  let health: Health;
  if (!novaryqFlagOn() || (cred && !enabled)) health = 'off';
  else if (!cred) health = 'not_connected';
  else if (cred.status !== 'CONNECTED' || (byState.DEAD ?? 0) > 0) health = 'failing';
  else if ((byState.FAILED ?? 0) > 0 || retrying > 0) health = 'degraded';
  else health = 'healthy';
  return {
    flagEnabled: novaryqFlagOn(),
    status: cred?.status ?? 'DISCONNECTED',
    summary,
    enabled,
    lastTestedAt: cred?.lastTestedAt ?? null,
    lastError: cred?.lastError ?? null,
    health,
    webhookUrl: novaryqWebhookUrl(restaurantId, brand.url),
    webhookEvents: NOVARYQ_WEBHOOK_EVENTS,
    lastWebhook: lastWebhook ? { at: lastWebhook.receivedAt, event: lastWebhook.event } : null,
    branches: branches.map((b) => ({ id: b.id, name: b.name, isActive: b.isActive, location: b.novaryqLink })),
    counts: byState,
    retrying,
  };
}

export interface CredentialInput { baseUrl: string; clientId: string; secret?: string; webhookSecret?: string; enabled: boolean }

/** Test-then-save. Blank secret fields keep the stored values (secrets are write-only in the UI). */
export async function saveNovaryqCredentials(ctx: AdminContext, input: CredentialInput) {
  const prev = await storedConfig(ctx.restaurantId);
  const cfg: NovaryqConfig = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    clientId: input.clientId.trim(),
    secret: input.secret?.trim() || prev?.secret || '',
    webhookSecret: input.webhookSecret?.trim() || prev?.webhookSecret || '',
    enabled: input.enabled,
    pushOn: 'RECEIVED',
  };
  if (!cfg.baseUrl || !cfg.clientId || !cfg.secret) return { ok: false as const, error: 'Novaryq URL, API key and API secret are required.' };
  const bad = await checkBaseUrl(cfg.baseUrl);
  if (bad) return { ok: false as const, error: bad };
  const result = await testAndSave(ctx.restaurantId, 'NOVARYQ', serializeNovaryqConfig(cfg), ctx.userId);
  await audit('integration.connect', {
    actorId: ctx.userId, restaurantId: ctx.restaurantId, entityType: 'IntegrationCredential', entityId: 'NOVARYQ',
    after: { provider: 'NOVARYQ', baseUrl: cfg.baseUrl, clientId: cfg.clientId, enabled: cfg.enabled, testOk: result.ok },
  });
  return result.ok ? { ok: true as const, detail: result.detail } : { ok: false as const, error: result.error ?? 'Test failed' };
}

export async function testStoredConnection(restaurantId: string) {
  const cfg = await storedConfig(restaurantId);
  if (!cfg) return { ok: false, error: 'Save your Novaryq credentials first.' };
  return testNovaryqConnection(cfg);
}

export async function disconnectNovaryq(ctx: AdminContext) {
  await disconnect(ctx.restaurantId, 'NOVARYQ');
  await audit('integration.disconnect', { actorId: ctx.userId, restaurantId: ctx.restaurantId, entityType: 'IntegrationCredential', entityId: 'NOVARYQ' });
}

const LOCATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Branch → Novaryq location. Refuses a location whose currency is not INR. */
export async function setBranchLocation(ctx: AdminContext, branchId: string, novaryqLocationId: string) {
  if (!LOCATION_ID.test(novaryqLocationId)) return { ok: false as const, error: 'Enter the Novaryq location id (letters, digits, - and _ only).' };
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId: ctx.restaurantId }, select: { id: true } });
  if (!branch) return { ok: false as const, error: 'Branch not found' };
  const cfg = await storedConfig(ctx.restaurantId);
  if (!cfg) return { ok: false as const, error: 'Save your Novaryq credentials first.' };
  const cur = await checkLocationCurrency(cfg, novaryqLocationId);
  if (!cur.ok) return cur;
  await prisma.novaryqLocationLink.upsert({
    where: { branchId },
    create: { restaurantId: ctx.restaurantId, branchId, novaryqLocationId, currency: cur.currency },
    update: { novaryqLocationId, currency: cur.currency },
  });
  await audit('integration.novaryq.location', { actorId: ctx.userId, restaurantId: ctx.restaurantId, entityType: 'Branch', entityId: branchId, after: { novaryqLocationId } });
  return { ok: true as const, itemCount: cur.itemCount };
}

export async function removeBranchLocation(ctx: AdminContext, branchId: string) {
  const r = await prisma.novaryqLocationLink.deleteMany({ where: { restaurantId: ctx.restaurantId, branchId } });
  if (r.count) await audit('integration.novaryq.location', { actorId: ctx.userId, restaurantId: ctx.restaurantId, entityType: 'Branch', entityId: branchId, after: null });
  return { ok: true as const, removed: r.count };
}

const SYNC_STATES = ['PENDING', 'SENT', 'FAILED', 'DEAD', 'CANCEL_PENDING', 'CANCELLED'] as const;

/** Sync log: order pushes (filterable by state) and the latest inbound webhook events. */
export async function syncLog(restaurantId: string, state?: string | null) {
  const where = { restaurantId, ...(state && (SYNC_STATES as readonly string[]).includes(state) ? { state: state as (typeof SYNC_STATES)[number] } : {}) };
  const [syncs, events] = await Promise.all([
    prisma.novaryqOrderSync.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, orderId: true, state: true, attempts: true, nextAttemptAt: true, lastError: true, lastStatus: true,
        lastStatusAt: true, novaryqOrderNumber: true, createdAt: true, updatedAt: true,
        order: { select: { code: true, status: true, total: true } },
      },
    }),
    prisma.novaryqWebhookEvent.findMany({
      where: { restaurantId },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      select: { id: true, event: true, receivedAt: true, processedAt: true, error: true, attempts: true },
    }),
  ]);
  return { syncs: syncs.map((s) => ({ ...s, order: s.order ? { ...s.order, total: Number(s.order.total) } : null })), events };
}
