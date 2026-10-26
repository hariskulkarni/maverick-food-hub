/**
 * Novaryq integration config (CONTRACT §4): the platform feature flag plus the
 * per-restaurant credential blob stored encrypted in IntegrationCredential(NOVARYQ):
 *   { baseUrl, clientId, secret, webhookSecret, enabled, pushOn: "RECEIVED", menuMaster, allowPriceOverride }
 * menuMaster = "POS: Novaryq" (ADR-FNI-001 §4.2): Novaryq owns name/price/availability of linked items;
 * allowPriceOverride = opt-in channel-only price on Flavrly for those items.
 * The webhook subscription itself is created by the owner in the Novaryq developer
 * console (CONTRACT-CHANGES NQ-1); its whsec_ secret is pasted into webhookSecret.
 * Values are strings (the integration store is Record<string, string>).
 */

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
  menuMaster: boolean;
  allowPriceOverride: boolean;
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
    menuMaster: raw.menuMaster === 'true',
    allowPriceOverride: raw.allowPriceOverride === 'true',
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
    menuMaster: c.menuMaster ? 'true' : 'false',
    allowPriceOverride: c.allowPriceOverride ? 'true' : 'false',
  };
}

export async function loadNovaryqConfig(restaurantId: string): Promise<NovaryqConfig | null> {
  // Lazy: orders.ts imports the outbox hooks (→ this file) on every order path; the integration
  // registry (all providers) is only loaded when a Novaryq config is actually read.
  const { getConfig } = await import('../integrations');
  return parseNovaryqConfig(await getConfig(restaurantId, 'NOVARYQ'));
}

/** Webhook path Novaryq posts to for this restaurant (CONTRACT §5). */
export function novaryqWebhookPath(restaurantId: string): string {
  return `/api/integrations/novaryq/webhook/${restaurantId}`;
}

/** Webhook URL the owner enters in Novaryq (NOVARYQ_WEBHOOK_BASE_URL overrides the public base). */
export function novaryqWebhookUrl(restaurantId: string, fallbackBase: string): string {
  const base = (process.env.NOVARYQ_WEBHOOK_BASE_URL || fallbackBase).replace(/\/+$/, '');
  return `${base}${novaryqWebhookPath(restaurantId)}`;
}
