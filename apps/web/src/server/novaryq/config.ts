/**
 * Novaryq integration config (CONTRACT §4): the platform feature flag plus the
 * per-restaurant credential blob stored encrypted in IntegrationCredential(NOVARYQ):
 *   { baseUrl, clientId, secret, webhookSecret, enabled, pushOn: "RECEIVED", webhookSubscriptionId? }
 * Values are strings (the integration store is Record<string, string>).
 */
import { getConfig } from '../integrations';

/** Platform kill switch. Off unless NOVARYQ_INTEGRATION_ENABLED=true. */
export function novaryqFlagOn(): boolean {
  return process.env.NOVARYQ_INTEGRATION_ENABLED === 'true';
}

export interface NovaryqConfig {
  baseUrl: string;
  clientId: string;
  secret: string;
  webhookSecret: string;
  enabled: boolean;
  pushOn: 'RECEIVED';
  webhookSubscriptionId: string;
}

export function parseNovaryqConfig(raw: Record<string, string> | null | undefined): NovaryqConfig | null {
  if (!raw || !raw.baseUrl || !raw.clientId || !raw.secret) return null;
  return {
    baseUrl: raw.baseUrl,
    clientId: raw.clientId,
    secret: raw.secret,
    webhookSecret: raw.webhookSecret ?? '',
    enabled: raw.enabled === 'true',
    pushOn: 'RECEIVED',
    webhookSubscriptionId: raw.webhookSubscriptionId ?? '',
  };
}

export function serializeNovaryqConfig(c: NovaryqConfig): Record<string, string> {
  return {
    baseUrl: c.baseUrl,
    clientId: c.clientId,
    secret: c.secret,
    webhookSecret: c.webhookSecret,
    enabled: c.enabled ? 'true' : 'false',
    pushOn: c.pushOn,
    webhookSubscriptionId: c.webhookSubscriptionId,
  };
}

export async function loadNovaryqConfig(restaurantId: string): Promise<NovaryqConfig | null> {
  return parseNovaryqConfig(await getConfig(restaurantId, 'NOVARYQ'));
}

/** Webhook path Novaryq posts to for this restaurant (CONTRACT §5). */
export function novaryqWebhookPath(restaurantId: string): string {
  return `/api/integrations/novaryq/webhook/${restaurantId}`;
}

/** Public base URL for the webhook registration (override for a QA simulator). */
export function novaryqWebhookUrl(restaurantId: string, fallbackBase: string): string {
  const base = (process.env.NOVARYQ_WEBHOOK_BASE_URL || fallbackBase).replace(/\/+$/, '');
  return `${base}${novaryqWebhookPath(restaurantId)}`;
}
