/**
 * YouPI-PG HTTP client (Payment API, default port 6100).
 *
 * ASSUMED CONTRACT — verify against live instance
 * ------------------------------------------------
 * No live YouPI instance was available when this was written; the shapes below
 * are inferred from the YouPI-PG README (fields event/orderId/amount/amountPaise/
 * utr/paymentId; outcomes success/failed/suspicious/expired/cancelled). Tune the
 * constants/parsers in this file once the real API is confirmed.
 *
 *   POST {baseUrl}/api/payments/create
 *     headers: authorization: Bearer <apiKey>, content-type: application/json
 *     body:    { orderId, amountPaise, customer?: {name, phone}, redirectUrl? }
 *     200:     { paymentId | id, checkoutUrl | checkout_url | url }
 *
 *   GET  {baseUrl}/api/payments/{paymentId}/status
 *     headers: authorization: Bearer <apiKey>
 *     200:     { status | outcome, utr?, amountPaise? }
 *
 * Status mapping (YouPI outcome, case-insensitive -> YoupiVerifyStatus):
 *   success                         -> CAPTURED
 *   failed, cancelled               -> FAILED
 *   pending, queued, processing     -> PENDING
 *   suspicious, expired, unknown,
 *   anything else / unparseable     -> UNKNOWN  (reconcile keeps order PENDING)
 *
 * Security: cfg.apiKey is masked ('***') out of every thrown/logged error text.
 */

export type YoupiConfig = {
  baseUrl: string;
  apiKey: string;
  webhookSecret?: string;
  receivingVpa?: string;
  dailyLimit?: number;
  maxAmountPaise?: number;
};

export type YoupiVerifyStatus = 'CAPTURED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

const TIMEOUT_MS = 20000;
const MAX_ERR = 200;

function mask(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('***') : text;
}

/** Mask first, then slice, so a key straddling the boundary can't leak a prefix. */
function safeMsg(text: string, apiKey: string): string {
  return mask(text, apiKey).slice(0, MAX_ERR);
}

function url(cfg: YoupiConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}${path}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function createYoupiPayment(
  cfg: YoupiConfig,
  args: {
    orderId: string;
    amountPaise: number;
    customer?: { name?: string | null; phone?: string | null };
    redirectUrl?: string;
  },
): Promise<{ paymentId: string; checkoutUrl: string }> {
  let res: Response;
  try {
    res = await fetch(url(cfg, '/api/payments/create'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        orderId: args.orderId,
        amountPaise: args.amountPaise,
        customer: args.customer,
        redirectUrl: args.redirectUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(safeMsg(`YouPI create failed: ${e instanceof Error ? e.message : String(e)}`, cfg.apiKey));
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(safeMsg(`YouPI create HTTP ${res.status}: ${text}`, cfg.apiKey));
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  const paymentId = str(data?.paymentId) ?? str(data?.id);
  const checkoutUrl = str(data?.checkoutUrl) ?? str(data?.checkout_url) ?? str(data?.url);
  if (!paymentId || !checkoutUrl) {
    throw new Error(safeMsg(`YouPI create: unexpected response: ${text}`, cfg.apiKey));
  }
  return { paymentId, checkoutUrl };
}

function mapOutcome(raw: unknown): YoupiVerifyStatus {
  switch (typeof raw === 'string' ? raw.trim().toLowerCase() : '') {
    case 'success':
      return 'CAPTURED';
    case 'failed':
    case 'cancelled':
      return 'FAILED';
    case 'pending':
    case 'queued':
    case 'processing':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

export async function getYoupiStatus(
  cfg: YoupiConfig,
  paymentId: string,
): Promise<{ status: YoupiVerifyStatus; utr?: string | null; amountPaise?: number | null }> {
  try {
    const res = await fetch(url(cfg, `/api/payments/${encodeURIComponent(paymentId)}/status`), {
      method: 'GET',
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'UNKNOWN' };
    const data = (await res.json()) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { status: 'UNKNOWN' };
    const amt = data.amountPaise;
    return {
      status: mapOutcome(data.status ?? data.outcome),
      utr: str(data.utr) ?? null,
      amountPaise: typeof amt === 'number' && Number.isFinite(amt) ? amt : null,
    };
  } catch (e) {
    // Fail safe: never throw into the reconcile loop; log with key masked.
    console.warn(safeMsg(`YouPI status check failed: ${e instanceof Error ? e.message : String(e)}`, cfg.apiKey));
    return { status: 'UNKNOWN' };
  }
}
