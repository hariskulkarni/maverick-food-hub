/**
 * PhonePe Payment Gateway — Standard Checkout V2 HTTP client.
 *
 * Thin, dependency-free wrapper over the four calls we need. No PhonePe SDK: it
 * pulls in a large dependency tree for what is four fetches, and pinning our own
 * client keeps the retry/token semantics explicit and testable.
 *
 * Endpoints (V2 — the OAuth flow, NOT the deprecated V1 salt-key/X-VERIFY one):
 *   POST {auth}/v1/oauth/token                                  → access token
 *   POST {api}/checkout/v2/pay                                  → create payment
 *   GET  {api}/checkout/v2/order/{merchantOrderId}/status        → order status
 *   POST {api}/payments/v2/refund                                → refund
 *   GET  {api}/payments/v2/refund/{merchantRefundId}/status      → refund status
 *
 * Docs:
 *   https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization
 *   https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment
 *   https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status
 *   https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/refund
 */

import crypto from 'node:crypto';

// ─── Configuration ──────────────────────────────────────────────────────────

export type PhonePeEnv = 'SANDBOX' | 'PRODUCTION';

export interface PhonePeConfig {
  clientId: string;
  clientSecret: string;
  /** Sent verbatim as `client_version`. PhonePe issues this alongside the id. */
  clientVersion: string;
  env: PhonePeEnv;
  /** Webhook basic-auth pair configured on the PhonePe dashboard. */
  webhookUsername?: string;
  webhookPassword?: string;
}

/**
 * Base URLs differ between environments *and* between the auth call and every
 * other call in production — a genuine asymmetry in PhonePe's routing, not a
 * typo. Sandbox serves everything from one prefix.
 */
export function phonePeBaseUrls(env: PhonePeEnv): { auth: string; api: string } {
  if (env === 'PRODUCTION') {
    return {
      auth: 'https://api.phonepe.com/apis/identity-manager',
      api: 'https://api.phonepe.com/apis/pg',
    };
  }
  return {
    auth: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    api: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  };
}

/** The customer-facing checkout bundle, loaded in the browser for the iframe PayPage. */
export function phonePeCheckoutScriptUrl(env: PhonePeEnv): string {
  return env === 'PRODUCTION'
    ? 'https://mercury.phonepe.com/web/bundle/checkout.js'
    : 'https://mercury-stg.phonepe.com/web/bundle/checkout.js';
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PhonePeError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly data: unknown;
  /** True when a retry could plausibly succeed (5xx / network / timeout). */
  readonly retryable: boolean;

  constructor(message: string, opts: { code?: string; httpStatus?: number; data?: unknown; retryable?: boolean } = {}) {
    super(message);
    this.name = 'PhonePeError';
    this.code = opts.code ?? 'PHONEPE_ERROR';
    this.httpStatus = opts.httpStatus ?? 0;
    this.data = opts.data ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

// ─── Token cache ────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  /** Epoch seconds. */
  expiresAt: number;
}

/**
 * Refresh this many seconds before `expires_at`. PhonePe's troubleshooting page
 * recommends renewing "at least 5 minutes before expiration"; we use exactly
 * that so a long-running request can never straddle the expiry.
 */
const TOKEN_REFRESH_MARGIN_SEC = 300;

const TOKEN_CACHE = new Map<string, CachedToken>();
/** In-flight fetches, so N concurrent checkouts issue one token request. */
const TOKEN_INFLIGHT = new Map<string, Promise<string>>();

/**
 * Cache key covers every field that changes the token's identity, with the
 * secret hashed so a heap dump of the Map never reveals it.
 */
function tokenKey(cfg: PhonePeConfig): string {
  const secretHash = crypto.createHash('sha256').update(cfg.clientSecret).digest('hex').slice(0, 16);
  return `${cfg.env}:${cfg.clientId}:${cfg.clientVersion}:${secretHash}`;
}

/** Test seam — drops all cached tokens. */
export function __resetPhonePeTokenCache(): void {
  TOKEN_CACHE.clear();
  TOKEN_INFLIGHT.clear();
}

async function fetchToken(cfg: PhonePeConfig): Promise<string> {
  const { auth } = phonePeBaseUrls(cfg.env);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_version: cfg.clientVersion,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials',
  });

  const res = await httpFetch(`${auth}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = await readJson(res);
  if (!res.ok) {
    throw new PhonePeError(errText(json) || `Auth failed (HTTP ${res.status})`, {
      code: pickCode(json) ?? 'AUTH_FAILED',
      httpStatus: res.status,
      data: json,
      retryable: res.status >= 500,
    });
  }

  const accessToken = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!accessToken) {
    throw new PhonePeError('Auth response contained no access_token', { code: 'AUTH_MALFORMED', data: json });
  }

  // `expires_at` is epoch *seconds*. Fall back to a conservative 15 minutes if
  // it is missing or nonsensical rather than caching a token forever.
  const rawExp = Number(json?.expires_at);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Number.isFinite(rawExp) && rawExp > nowSec ? rawExp : nowSec + 900;

  TOKEN_CACHE.set(tokenKey(cfg), { accessToken, expiresAt });
  return accessToken;
}

/**
 * A valid access token, cached across requests and de-duplicated across
 * concurrent callers. `force` bypasses the cache (used once on a 401).
 */
export async function getAccessToken(cfg: PhonePeConfig, force = false): Promise<string> {
  const key = tokenKey(cfg);
  if (!force) {
    const hit = TOKEN_CACHE.get(key);
    if (hit && hit.expiresAt - TOKEN_REFRESH_MARGIN_SEC > Math.floor(Date.now() / 1000)) {
      return hit.accessToken;
    }
    const pending = TOKEN_INFLIGHT.get(key);
    if (pending) return pending;
  } else {
    TOKEN_CACHE.delete(key);
  }

  const p = fetchToken(cfg).finally(() => TOKEN_INFLIGHT.delete(key));
  TOKEN_INFLIGHT.set(key, p);
  return p;
}

// ─── HTTP plumbing ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 20_000;

async function httpFetch(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal, cache: 'no-store' });
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? `Request to PhonePe timed out after ${timeoutMs}ms` : (e as Error).message;
    throw new PhonePeError(msg, { code: 'NETWORK_ERROR', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function pickCode(json: any): string | null {
  return typeof json?.code === 'string' ? json.code : typeof json?.errorCode === 'string' ? json.errorCode : null;
}
function errText(json: any): string {
  return (
    (typeof json?.message === 'string' && json.message) ||
    (typeof json?.error_description === 'string' && json.error_description) ||
    (typeof json?.raw === 'string' && json.raw.slice(0, 300)) ||
    ''
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOpts {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Retry attempts for 5xx/network failures. 0 for non-idempotent calls. */
  retries?: number;
  timeoutMs?: number;
}

/**
 * Authenticated call against the PG base URL.
 *
 * Handles the two failure modes worth automating: an expired token (one forced
 * refresh + replay on 401) and transient upstream failure (bounded backoff on
 * 5xx/network for calls the caller marks retryable). Everything else is
 * surfaced as a PhonePeError for the caller to map.
 */
async function call<T>(cfg: PhonePeConfig, opts: CallOpts): Promise<T> {
  const { api } = phonePeBaseUrls(cfg.env);
  const url = `${api}${opts.path}`;
  const retries = opts.retries ?? 0;

  let lastErr: PhonePeError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let token = await getAccessToken(cfg);

    const doFetch = (t: string) =>
      httpFetch(url, {
        method: opts.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `O-Bearer ${t}`,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        timeoutMs: opts.timeoutMs,
      });

    let res: Response;
    try {
      res = await doFetch(token);
      // A 401 almost always means the token aged out between cache check and
      // arrival. Force-refresh once and replay before treating it as fatal.
      if (res.status === 401) {
        token = await getAccessToken(cfg, true);
        res = await doFetch(token);
      }
    } catch (e) {
      lastErr = e as PhonePeError;
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw lastErr;
    }

    const json = await readJson(res);

    if (res.ok) return json as T;

    const err = new PhonePeError(errText(json) || `PhonePe returned HTTP ${res.status}`, {
      code: pickCode(json) ?? `HTTP_${res.status}`,
      httpStatus: res.status,
      data: json,
      retryable: res.status >= 500,
    });

    if (err.retryable && attempt < retries) {
      lastErr = err;
      await sleep(250 * 2 ** attempt);
      continue;
    }
    throw err;
  }

  throw lastErr ?? new PhonePeError('PhonePe request failed', { code: 'UNKNOWN' });
}

// ─── Request/response types ─────────────────────────────────────────────────

/**
 * One payment-mode constraint.
 *
 * `type` picks the family; every other key narrows it. PhonePe evaluates the
 * dimensions with AND logic, and an omitted dimension means "match all values
 * for that dimension" — so `{ type: 'CARD' }` is every card, while
 * `{ type: 'CARD', types: ['DEBIT_CARD'], networks: ['VISA'] }` is Visa debit
 * only. Note PhonePe processes **only the first constraint for each `type`**,
 * so don't send two `CARD` entries expecting a union.
 *
 * Valid values are on the Supported Values page; the unions below mirror it.
 */
export interface PhonePeModeConstraint {
  type: 'UPI' | 'CARD' | 'NET_BANKING' | 'CORPORATE_NET_BANKING' | 'EMI' | 'WALLET';
  /** UPI: INTENT | COLLECT | QR */
  flows?: string[];
  /** UPI: lowercase app ids — phonepe, gpay, paytm, bhim, amazon, cred, … */
  apps?: string[];
  /** UPI: BANK_ACCOUNT | RUPAY_CC | CREDIT_LINE */
  instruments?: string[];
  /** CARD/EMI: CREDIT_CARD | DEBIT_CARD */
  types?: string[];
  /** CARD: VISA | MASTER_CARD | RUPAY | AMEX | DINERS_CLUB */
  networks?: string[];
  /** CARD: CONSUMER | PREMIUM | SUPER_PREMIUM | CORPORATE */
  variants?: string[];
  /** CARD: DOMESTIC | INTERNATIONAL */
  geoScopes?: string[];
  /** NET_BANKING / CORPORATE_NET_BANKING: bank codes (HDFC, ICIC, SBIN, …) */
  banks?: string[];
  /** WALLET: PHONEPE */
  wallets?: string[];
}

export interface PhonePePaymentModeConfig {
  enabledPaymentModes?: PhonePeModeConstraint[];
  disabledPaymentModes?: PhonePeModeConstraint[];
}

export interface CreatePaymentInput {
  /** Max 63 chars, `[A-Za-z0-9_-]` only. */
  merchantOrderId: string;
  /** Paisa. PhonePe enforces a 100 (₹1) minimum. */
  amountPaisa: number;
  redirectUrl: string;
  /** Seconds until the checkout expires. PhonePe accepts 300–3600. */
  expireAfter?: number;
  message?: string;
  /**
   * udf1–udf15, echoed back on every status response and webhook. Sanitised
   * before sending — see `sanitizeMetaInfo` for the per-field rules.
   */
  metaInfo?: Record<string, string>;
  paymentModeConfig?: PhonePePaymentModeConfig;
  disablePaymentRetry?: boolean;
  /**
   * Customer's mobile, pre-filled on the PayPage so they don't retype it.
   * Only sent when it parses as a valid Indian mobile — see `toPhonePePhone`.
   */
  customerPhone?: string | null;
}

export interface CreatePaymentResult {
  orderId: string;
  state: string;
  expireAt: number;
  redirectUrl: string;
  raw: Record<string, unknown>;
}

export interface PhonePePaymentDetail {
  transactionId?: string;
  paymentMode?: string;
  timestamp?: number;
  amount?: number;
  payableAmount?: number;
  feeAmount?: number;
  state?: string;
  errorCode?: string;
  detailedErrorCode?: string;
  rail?: Record<string, unknown>;
  instrument?: Record<string, unknown>;
  splitInstruments?: Array<Record<string, unknown>>;
}

export interface OrderStatusResult {
  orderId: string;
  state: string;
  amount?: number;
  payableAmount?: number;
  feeAmount?: number;
  expireAt?: number;
  errorCode?: string;
  detailedErrorCode?: string;
  metaInfo?: Record<string, string>;
  paymentDetails?: PhonePePaymentDetail[];
  errorContext?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface RefundResultRaw {
  refundId: string;
  amount: number;
  state: string;
  raw: Record<string, unknown>;
}

export interface RefundStatusResult {
  originalMerchantOrderId?: string;
  amount?: number;
  state: string;
  refundId?: string;
  timestamp?: number;
  errorCode?: string;
  detailedErrorCode?: string;
  splitInstruments?: Array<Record<string, unknown>>;
  raw: Record<string, unknown>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const MERCHANT_ID_RE = /^[A-Za-z0-9_-]{1,63}$/;

/**
 * PhonePe rejects merchant ids with any character outside `[A-Za-z0-9_-]` or
 * longer than 63 chars, with an unhelpful generic BAD_REQUEST. Fail locally
 * with a precise message instead.
 */
export function assertMerchantId(value: string, label: string): void {
  if (!MERCHANT_ID_RE.test(value)) {
    throw new PhonePeError(
      `${label} "${value}" is invalid — must be 1-63 chars of letters, digits, underscore or hyphen.`,
      { code: 'INVALID_MERCHANT_ID' },
    );
  }
}

/** Sanitise an arbitrary internal id into something PhonePe will accept. */
export function toMerchantId(raw: string, maxLen = 63): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-{2,}/g, '-');
  return cleaned.slice(0, maxLen) || `id-${crypto.randomBytes(8).toString('hex')}`;
}

/** ₹ → paisa, rounded to the nearest paisa to avoid float drift on totals. */
export function toPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

/** udf11–udf15 accept only these characters. */
const UDF_STRICT_DISALLOWED = /[^A-Za-z0-9_\-+@.]/g;

/**
 * Clamp `metaInfo` to what PhonePe actually accepts.
 *
 * The limits are asymmetric and undocumented in the summary pages, which makes
 * them an easy way to earn an opaque BAD_REQUEST:
 *   udf1–udf10   any characters, max 256 chars
 *   udf11–udf15  `[A-Za-z0-9_-+@.]` only, max 50 chars
 * Keys outside udf1–udf15 are dropped — PhonePe ignores them and they only add
 * noise to the echoed payloads. Empty values are dropped too.
 *
 * Truncating beats rejecting: metaInfo is diagnostic breadcrumbs, never
 * something we key on, so a clipped value must not cost the customer a payment.
 */
export function sanitizeMetaInfo(meta: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(meta)) {
    const m = /^udf(\d{1,2})$/.exec(key);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 15) continue;
    let v = String(raw ?? '');
    if (!v) continue;
    v = n >= 11 ? v.replace(UDF_STRICT_DISALLOWED, '-').slice(0, 50) : v.slice(0, 256);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Normalise a phone number for `prefillUserLoginDetails`, or null if we can't
 * be confident about it.
 *
 * Deliberately strict: this field is a convenience, but a malformed value would
 * fail the whole create-payment call. So anything that isn't unambiguously an
 * Indian mobile (10 digits starting 6–9, optionally already +91-prefixed) is
 * dropped rather than guessed at — the customer just types it on the PayPage.
 */
export function toPhonePePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;

  const local = digits.slice(-10);
  const prefix = digits.slice(0, -10);
  // Accept the ways an Indian mobile is actually written — bare, with the
  // national trunk 0, or with the country code — and reject everything else.
  // Checking the prefix (rather than just taking the last 10 digits) is what
  // stops a foreign number like +1 415 555 0134 being mangled into a
  // plausible-looking Indian one.
  if (!['', '0', '91', '091'].includes(prefix)) return null;
  if (!/^[6-9]/.test(local)) return null;
  return `+91${local}`;
}

/**
 * Re-exported for server callers (reconciler, sweeper) so they share the exact
 * cadence the browser uses. Defined in `lib/` because it must stay free of
 * Node built-ins — see that module.
 */
export { phonePeStatusPollDelays } from '@/lib/phonepe-poll';

/** PhonePe's floor: ₹1. */
export const MIN_AMOUNT_PAISA = 100;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a checkout order and get back the PayPage token URL.
 *
 * Deliberately **not** retried: `merchantOrderId` is unique per attempt, so a
 * retry after an ambiguous 5xx risks a duplicate-order 400 that would mask the
 * real state. Callers reconcile with `getOrderStatus` instead.
 */
export async function createPayment(cfg: PhonePeConfig, input: CreatePaymentInput): Promise<CreatePaymentResult> {
  assertMerchantId(input.merchantOrderId, 'merchantOrderId');
  if (!Number.isInteger(input.amountPaisa) || input.amountPaisa < MIN_AMOUNT_PAISA) {
    throw new PhonePeError(`Amount must be a whole number of paisa ≥ ${MIN_AMOUNT_PAISA} (got ${input.amountPaisa}).`, {
      code: 'INVALID_AMOUNT',
    });
  }
  if (input.paymentModeConfig?.enabledPaymentModes && input.paymentModeConfig?.disabledPaymentModes) {
    throw new PhonePeError('Provide either enabledPaymentModes or disabledPaymentModes, never both.', {
      code: 'INVALID_PAYMENT_MODE_CONFIG',
    });
  }

  const body: Record<string, unknown> = {
    merchantOrderId: input.merchantOrderId,
    amount: input.amountPaisa,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      ...(input.message ? { message: input.message } : {}),
      merchantUrls: { redirectUrl: input.redirectUrl },
      // `version: 'V2'` is what unlocks the dimensional filters (flows, apps,
      // networks, geoScopes…). Without it PhonePe falls back to the old flat
      // format and silently ignores them, so it is injected here rather than
      // left to each caller to remember.
      ...(input.paymentModeConfig
        ? { paymentModeConfig: { version: 'V2', ...input.paymentModeConfig } }
        : {}),
    },
  };
  // PhonePe accepts 300–3600s; clamp rather than let it 400 on a bad setting.
  if (input.expireAfter != null) {
    body.expireAfter = Math.min(3600, Math.max(300, Math.round(input.expireAfter)));
  }
  if (input.metaInfo) {
    const meta = sanitizeMetaInfo(input.metaInfo);
    if (Object.keys(meta).length > 0) body.metaInfo = meta;
  }
  if (input.disablePaymentRetry != null) body.disablePaymentRetry = input.disablePaymentRetry;
  // Pre-fill the customer's mobile on the PayPage. Omitted entirely when we
  // can't validate it — see toPhonePePhone.
  const prefillPhone = toPhonePePhone(input.customerPhone);
  if (prefillPhone) body.prefillUserLoginDetails = { phoneNumber: prefillPhone };

  const json = await call<any>(cfg, { method: 'POST', path: '/checkout/v2/pay', body, retries: 0 });

  if (!json?.redirectUrl) {
    throw new PhonePeError('PhonePe accepted the order but returned no redirectUrl', {
      code: 'NO_REDIRECT_URL',
      data: json,
    });
  }
  return {
    orderId: String(json.orderId ?? ''),
    state: String(json.state ?? 'PENDING'),
    expireAt: Number(json.expireAt ?? 0),
    redirectUrl: String(json.redirectUrl),
    raw: json,
  };
}

/**
 * Authoritative order state. Safe to retry — it is a pure read, and it is our
 * fallback whenever a webhook is late, lost, or unverifiable.
 */
export async function getOrderStatus(
  cfg: PhonePeConfig,
  merchantOrderId: string,
  opts: { details?: boolean; errorContext?: boolean } = {},
): Promise<OrderStatusResult> {
  assertMerchantId(merchantOrderId, 'merchantOrderId');
  const q = new URLSearchParams({
    details: String(opts.details ?? true),
    errorContext: String(opts.errorContext ?? true),
  });
  const json = await call<any>(cfg, {
    method: 'GET',
    path: `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?${q}`,
    retries: 2,
  });
  return {
    orderId: String(json?.orderId ?? ''),
    state: String(json?.state ?? 'PENDING'),
    amount: json?.amount,
    payableAmount: json?.payableAmount,
    feeAmount: json?.feeAmount,
    expireAt: json?.expireAt,
    errorCode: json?.errorCode,
    detailedErrorCode: json?.detailedErrorCode,
    metaInfo: json?.metaInfo,
    paymentDetails: Array.isArray(json?.paymentDetails) ? json.paymentDetails : [],
    errorContext: json?.errorContext,
    raw: json ?? {},
  };
}

/**
 * Initiate a refund. Retryable: PhonePe keys refunds on `merchantRefundId`, so
 * a replayed request returns the existing refund rather than creating a second.
 */
export async function createRefund(
  cfg: PhonePeConfig,
  input: { merchantRefundId: string; originalMerchantOrderId: string; amountPaisa: number },
): Promise<RefundResultRaw> {
  assertMerchantId(input.merchantRefundId, 'merchantRefundId');
  assertMerchantId(input.originalMerchantOrderId, 'originalMerchantOrderId');
  if (!Number.isInteger(input.amountPaisa) || input.amountPaisa < MIN_AMOUNT_PAISA) {
    throw new PhonePeError(`Refund amount must be a whole number of paisa ≥ ${MIN_AMOUNT_PAISA}.`, {
      code: 'INVALID_AMOUNT',
    });
  }
  const json = await call<any>(cfg, {
    method: 'POST',
    path: '/payments/v2/refund',
    body: {
      merchantRefundId: input.merchantRefundId,
      originalMerchantOrderId: input.originalMerchantOrderId,
      amount: input.amountPaisa,
    },
    retries: 2,
  });
  return {
    refundId: String(json?.refundId ?? ''),
    amount: Number(json?.amount ?? input.amountPaisa),
    state: String(json?.state ?? 'PENDING'),
    raw: json ?? {},
  };
}

/** Refund state. Pure read — retried. */
export async function getRefundStatus(cfg: PhonePeConfig, merchantRefundId: string): Promise<RefundStatusResult> {
  assertMerchantId(merchantRefundId, 'merchantRefundId');
  const json = await call<any>(cfg, {
    method: 'GET',
    path: `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`,
    retries: 2,
  });
  return {
    originalMerchantOrderId: json?.originalMerchantOrderId,
    amount: json?.amount,
    state: String(json?.state ?? 'PENDING'),
    refundId: json?.refundId,
    timestamp: json?.timestamp,
    errorCode: json?.errorCode,
    detailedErrorCode: json?.detailedErrorCode,
    splitInstruments: json?.splitInstruments,
    raw: json ?? {},
  };
}
