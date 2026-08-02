/**
 * Integration store. Server-only — never import from a Client Component.
 *
 *   getConfig(restaurantId, provider)    → decrypted credentials or null
 *   listForRestaurant(restaurantId)       → status + summary for every provider
 *   saveConfig(restaurantId, provider, c) → encrypt, upsert, mark CONNECTED
 *   testAndSave(restaurantId, provider, c)→ test() first, then save with status
 *   disconnect(restaurantId, provider)    → delete row
 *
 * Runtime callers (payments, notifications) use `getConfig` to prefer
 * tenant-stored creds over env. If neither exists, the adapter falls back
 * to mock.
 */

import { prisma } from '../db';
import { decryptJSON, encryptJSON } from '../crypto';
import { PROVIDERS, PROVIDER_LIST, ProviderKey } from './providers';
import { wrap, invalidateTag, keys as cacheKeys } from '../cache';

export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'FAILED';

/**
 * Decrypted integration credentials, cached so order-time payments don't hit
 * Postgres + argon decrypt on every call. Read through the shared cache so
 * the in-process Map gives way to Redis automatically — meaning two pm2
 * workers share the same hot creds and a key rotation in saveConfig is
 * visible everywhere in one round-trip.
 *
 * Negative caching uses the same TTL (any change calls invalidateTag below).
 */
export async function getConfig(restaurantId: string, provider: ProviderKey): Promise<Record<string, string> | null> {
  return wrap<Record<string, string>>(
    [cacheKeys.integrationConfig(restaurantId, provider)],
    {
      ttlMs: 5 * 60_000,
      staleMs: 60_000,
      tags: [`integration:${restaurantId}`, `integration:${restaurantId}:${provider}`],
      label: 'integration.config',
    },
    async () => {
      const row = await prisma.integrationCredential.findUnique({
        where: { restaurantId_provider: { restaurantId, provider: provider as any } },
      });
      if (!row || row.status !== 'CONNECTED') return null;
      try {
        return decryptJSON<Record<string, string>>(row.configEncrypted);
      } catch {
        return null;
      }
    },
  );
}

/**
 * Longest parent chain we will walk. Restaurant groups are one level deep today
 * (parent → children); the cap exists so a cycle introduced by a bad data fix
 * degrades into "no credentials" rather than an infinite loop at checkout.
 */
const MAX_GROUP_DEPTH = 5;

export interface InheritedConfig {
  config: Record<string, string>;
  /** The restaurant the credentials are actually stored on. */
  ownerRestaurantId: string;
  /** True when they came from an ancestor rather than this restaurant. */
  inherited: boolean;
}

/**
 * Credentials for a restaurant, falling back to its ancestors.
 *
 * A group connects a gateway once on the parent (e.g. Bowl & Barbeque) and every
 * child outlet transacts on it — money settles to the parent's registered bank,
 * and rotating a secret is one edit rather than one per outlet. A child that
 * connects its own credentials still wins: the walk stops at the first CONNECTED
 * row it finds, starting from the child itself.
 *
 * Only the id lookups are uncached (they are indexed primary-key reads); the
 * credential decrypt itself still goes through the cached getConfig above.
 */
export async function getConfigInherited(
  restaurantId: string,
  provider: ProviderKey,
): Promise<InheritedConfig | null> {
  let currentId: string | null = restaurantId;
  const seen = new Set<string>();

  for (let depth = 0; currentId && depth < MAX_GROUP_DEPTH; depth++) {
    if (seen.has(currentId)) break; // cycle guard
    seen.add(currentId);

    const config = await getConfig(currentId, provider);
    if (config) {
      return { config, ownerRestaurantId: currentId, inherited: currentId !== restaurantId };
    }

    const row: { parentId: string | null } | null = await prisma.restaurant.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = row?.parentId ?? null;
  }
  return null;
}

export async function listForRestaurant(restaurantId: string) {
  const rows = await prisma.integrationCredential.findMany({ where: { restaurantId } });
  return PROVIDER_LIST.map((def) => {
    const row = rows.find((r) => r.provider === def.key);
    return {
      provider: def.key,
      title: def.title,
      vendor: def.vendor,
      description: def.description,
      docsUrl: def.docsUrl,
      fields: def.fields,
      status: (row?.status ?? 'DISCONNECTED') as IntegrationStatus,
      summary: row?.summary ?? null,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastError: row?.lastError ?? null,
      updatedAt: row?.updatedAt ?? null
    };
  });
}

export async function saveConfig(
  restaurantId: string,
  provider: ProviderKey,
  config: Record<string, string>,
  opts: { status?: IntegrationStatus; lastError?: string | null; userId?: string } = {}
) {
  const def = PROVIDERS[provider];
  const summary = def.buildSummary(config);
  const status = opts.status ?? 'CONNECTED';
  const row = await prisma.integrationCredential.upsert({
    where: { restaurantId_provider: { restaurantId, provider: provider as any } },
    update: {
      status: status as any,
      configEncrypted: encryptJSON(config),
      summary: summary as any,
      lastTestedAt: new Date(),
      lastError: opts.lastError ?? null
    },
    create: {
      restaurantId,
      provider: provider as any,
      status: status as any,
      configEncrypted: encryptJSON(config),
      summary: summary as any,
      lastTestedAt: new Date(),
      lastError: opts.lastError ?? null,
      createdById: opts.userId ?? null
    }
  });
  await invalidateTag(`integration:${restaurantId}:${provider}`);
  return row;
}

export async function testConfig(provider: ProviderKey, config: Record<string, string>) {
  const def = PROVIDERS[provider];
  return def.test(config);
}

export async function testAndSave(restaurantId: string, provider: ProviderKey, config: Record<string, string>, userId?: string) {
  const result = await testConfig(provider, config);
  await saveConfig(restaurantId, provider, config, {
    status: result.ok ? 'CONNECTED' : 'FAILED',
    lastError: result.ok ? null : result.error ?? 'Test failed',
    userId
  });
  return result;
}

export async function disconnect(restaurantId: string, provider: ProviderKey) {
  await prisma.integrationCredential.deleteMany({ where: { restaurantId, provider: provider as any } });
  await invalidateTag(`integration:${restaurantId}:${provider}`);
}
