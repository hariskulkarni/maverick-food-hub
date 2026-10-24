/**
 * Flavrly PG HTTP client (Payment Core REST API, default port 6100).
 *
 * Contract verified against gateway source (upstream d7b0741 and our fork 7720b49);
 * see docs/flavrly-pg/UPSTREAM_CONTRACT.md for file:line evidence.
 *
 *   POST {baseUrl}/api/v1/payments
 *     headers: X-Merchant-Id, X-Merchant-Key (merchantKey || webhookSecret), Idempotency-Key
 *     body:    { orderId: <attemptKey>, amount: "<INR>.<dd>", currency: "INR", customer?, returnUrl? }
 *     201/200: { paymentId, orderId, amountPaise, currency, status, checkoutUrl }
 *     The gateway de-duplicates by (merchant, orderId), NOT by Idempotency-Key (stored only).
 *
 *   GET  {baseUrl}/api/v1/payments/{paymentId}           (X-Merchant-Key unlocks the private view)
 *   GET  {baseUrl}/api/v1/orders/{orderId}/cod           (lookup by merchant orderId; X-Merchant-Id + X-Merchant-Key)
 *     private view adds metadata.receivingAccountSnapshot.upiId. No utr, no expiresAt.
 *
 * Status (gateway -> YoupiVerifyStatus), case-insensitive:
 *   SUCCESS                               -> OBSERVED  (an observation, never a capture: contract D2)
 *   FAILED, CANCELLED, EXPIRED            -> FAILED
 *   INITIATED, ACTIVE, QUEUED, PROCESSING -> PENDING
 *   anything else / unparseable           -> UNKNOWN
 *
 * Security: merchantKey and webhookSecret are masked ('***') out of every thrown/logged text,
 * and never leave the server.
 */

import { paiseToInrString } from '@/server/pg/money';
import { GATEWAY_FETCH_REDIRECT } from '@/server/pg/security';

export type YoupiConfig = {
  baseUrl: string;
  merchantId: string;
  webhookSecret: string;
  /** Distinct merchant API key; defaults to webhookSecret (see UPSTREAM_CONTRACT.md §2). */
  merchantKey?: string;
  /** The bound receiving account's VPA (authoritative; from PgReceivingAccount). */
  receivingVpa?: string;
  receivingAccountId?: string;
  dailyLimit?: number;
  maxAmountPaise?: number;
  /** Production: checkout URL origin must match FLAVRLY_PG_CHECKOUT_ORIGIN. */
  requireReceiverMatch?: boolean;
};

/**
 * 'CAPTURED' is never returned (contract D2). It stays in the union only so legacy
 * callers that compare against it keep compiling until they migrate.
 */
export type YoupiVerifyStatus = 'OBSERVED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

/** Parsed gateway payment view (public or merchant-private). */
export type YoupiPaymentView = {
  paymentId: string | null;
  orderId: string | null;
  amountPaise: number | null;
  currency: string | null;
  /** Gateway status as sent, upper-cased (e.g. 'SUCCESS', 'INITIATED'). */
  gatewayStatus: string;
  status: YoupiVerifyStatus;
  /** metadata.receivingAccountSnapshot.upiId, lower-cased; null when absent (e.g. public view). */
  receiverVpa: string | null;
  utr: string | null;
};

export type YoupiCreateOutcome =
  | { kind: 'created'; paymentId: string; checkoutUrl: string; httpStatus: number }
  /** Definitive rejection: the gateway did not create a session. */
  | { kind: 'rejected'; httpStatus: number; error: string }
  /** A session may or may not exist remotely (timeout, network, 5xx, 408/409, malformed 2xx). */
  | { kind: 'unknown'; httpStatus?: number; error: string };

export type YoupiReadResult =
  | { kind: 'found'; view: YoupiPaymentView }
  | { kind: 'not_found' }
  | { kind: 'error'; error: string };

const TIMEOUT_MS = 20000;
const MAX_ERR = 200;

export function youpiAuthKey(cfg: YoupiConfig): string {
  return cfg.merchantKey || cfg.webhookSecret;
}

/** Mask every secret first, then slice, so a secret straddling the boundary can't leak a prefix. */
function safeMsg(text: string, cfg: YoupiConfig): string {
  let out = text;
  for (const s of [cfg.merchantKey, cfg.webhookSecret]) if (s) out = out.split(s).join('***');
  return out.slice(0, MAX_ERR);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function url(cfg: YoupiConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}${path}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** amountPaise is a string on gateway responses. Integer only; anything else is null (never rounded). */
function toPaise(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function mapStatus(raw: string): YoupiVerifyStatus {
  switch (raw) {
    case 'SUCCESS':
      return 'OBSERVED';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'FAILED';
    case 'INITIATED':
    case 'ACTIVE':
    case 'QUEUED':
    case 'PROCESSING':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

export function parseYoupiView(data: Record<string, unknown>): YoupiPaymentView {
  const gatewayStatus = typeof data.status === 'string' ? data.status.trim().toUpperCase() : '';
  const metadata = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : null;
  const snap = metadata?.receivingAccountSnapshot as Record<string, unknown> | undefined;
  const vpa = typeof snap?.upiId === 'string' ? snap.upiId.trim().toLowerCase() : '';
  return {
    paymentId: str(data.paymentId) ?? null,
    orderId: str(data.orderId) ?? null,
    amountPaise: toPaise(data.amountPaise),
    currency: str(data.currency) ?? null,
    gatewayStatus,
    status: mapStatus(gatewayStatus),
    receiverVpa: vpa || null,
    utr: str(data.utr) ?? null,
  };
}

/**
 * Creates a gateway session. Never throws: the outcome says whether a session exists,
 * definitely does not exist, or may exist (caller must then treat it as CREATE_UNKNOWN).
 */
export async function createYoupiSession(
  cfg: YoupiConfig,
  args: {
    /** The attempt key; unique per attempt. */
    orderId: string;
    amountPaise: number;
    customer?: { name?: string | null; phone?: string | null };
    redirectUrl?: string;
  },
): Promise<YoupiCreateOutcome> {
  let amountInr: string;
  try {
    amountInr = paiseToInrString(args.amountPaise);
  } catch (e) {
    return { kind: 'rejected', httpStatus: 0, error: `invalid amount: ${errText(e)}` };
  }
  const customer = args.customer
    ? { name: args.customer.name ?? undefined, phoneNumber: args.customer.phone ?? undefined }
    : undefined;

  let res: Response;
  try {
    res = await fetch(url(cfg, '/api/v1/payments'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Merchant-Id': cfg.merchantId,
        // Server-to-server ONLY: never expose merchant keys to the browser.
        'X-Merchant-Key': youpiAuthKey(cfg),
        // Stored by the gateway, not enforced; real de-dup is the unique orderId (attemptKey).
        'Idempotency-Key': args.orderId,
      },
      body: JSON.stringify({
        orderId: args.orderId,
        amount: amountInr,
        currency: 'INR',
        customer,
        returnUrl: args.redirectUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never follow a redirect carrying X-Merchant-Key to another host (T-07).
      redirect: GATEWAY_FETCH_REDIRECT,
    });
  } catch (e) {
    return { kind: 'unknown', error: safeMsg(`Flavrly PG create failed: ${errText(e)}`, cfg) };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const error = safeMsg(`Flavrly PG create HTTP ${res.status}: ${text}`, cfg);
    // 408 timeout and 409 (order already exists / amount conflict) do not prove absence.
    const definitive = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409;
    return definitive ? { kind: 'rejected', httpStatus: res.status, error } : { kind: 'unknown', httpStatus: res.status, error };
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  const paymentId = str(data?.paymentId);
  const checkoutUrl = str(data?.checkoutUrl);
  if (!paymentId || !checkoutUrl) {
    return { kind: 'unknown', httpStatus: res.status, error: safeMsg(`Flavrly PG create: unexpected response: ${text}`, cfg) };
  }
  return { kind: 'created', paymentId, checkoutUrl, httpStatus: res.status };
}

async function readView(cfg: YoupiConfig, path: string, headers: Record<string, string>): Promise<YoupiReadResult> {
  try {
    const res = await fetch(url(cfg, path), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: GATEWAY_FETCH_REDIRECT,
    });
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` };
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object') return { kind: 'error', error: 'non-object body' };
    return { kind: 'found', view: parseYoupiView(data as Record<string, unknown>) };
  } catch (e) {
    return { kind: 'error', error: safeMsg(errText(e), cfg) };
  }
}

/** Merchant-private payment view by gateway paymentId. */
export function readYoupiPayment(cfg: YoupiConfig, paymentId: string): Promise<YoupiReadResult> {
  return readView(cfg, `/api/v1/payments/${encodeURIComponent(paymentId)}`, { 'X-Merchant-Key': youpiAuthKey(cfg) });
}

/** Merchant-private view by OUR gateway orderId (attemptKey); 404 = no session for this merchant+orderId. */
export function findYoupiPaymentByOrderId(cfg: YoupiConfig, orderId: string): Promise<YoupiReadResult> {
  return readView(cfg, `/api/v1/orders/${encodeURIComponent(orderId)}/cod`, {
    'X-Merchant-Id': cfg.merchantId,
    'X-Merchant-Key': youpiAuthKey(cfg),
  });
}

export async function getYoupiStatus(
  cfg: YoupiConfig,
  paymentId: string,
): Promise<{
  status: YoupiVerifyStatus;
  gatewayStatus?: string;
  orderId?: string | null;
  currency?: string | null;
  receiverVpa?: string | null;
  utr?: string | null;
  amountPaise?: number | null;
}> {
  const r = await readYoupiPayment(cfg, paymentId);
  if (r.kind !== 'found') {
    // Fail safe: never throw into the reconcile loop; secrets already masked.
    if (r.kind === 'error') console.warn(`Flavrly PG status check failed: ${r.error}`);
    return { status: 'UNKNOWN' };
  }
  const v = r.view;
  return {
    status: v.status,
    gatewayStatus: v.gatewayStatus,
    orderId: v.orderId,
    currency: v.currency,
    receiverVpa: v.receiverVpa,
    // utr is only delivered on the webhook payload, never on the status view.
    utr: v.utr,
    amountPaise: v.amountPaise,
  };
}
