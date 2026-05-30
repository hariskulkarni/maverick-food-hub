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
