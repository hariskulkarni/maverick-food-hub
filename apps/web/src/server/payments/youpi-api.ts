/**
 * Flavrly PG HTTP client (Payment Core REST API, default port 6100).
 *
 * Verified against the public Flavrly PG spec (openapi.yaml / MERCHANT_INTEGRATION):
 *
 *   POST {baseUrl}/api/v1/payments
 *     headers: X-Merchant-Id: <merchantId>, Idempotency-Key: <orderId>, content-type: application/json
 *     body:    { orderId, amount: "<INR>.<dd>", currency: "INR", customer?, returnUrl?, metadata? }
 *     201/200: { paymentId, orderId, amount, amountPaise, currency, status, checkoutUrl }
 *
 *   GET  {baseUrl}/api/v1/payments/{paymentId}
 *     headers: X-Merchant-Key: <webhookSecret>   // unlocks the merchant-private view
 *     200:     { paymentId, status, amountPaise, verificationLevel, completedAt, ... }
 *
 * Status (Flavrly PG -> YoupiVerifyStatus), case-insensitive:
 *   SUCCESS                               -> CAPTURED
 *   FAILED, CANCELLED, EXPIRED            -> FAILED
 *   INITIATED, ACTIVE, QUEUED, PROCESSING -> PENDING
 *   anything else / unparseable           -> UNKNOWN  (reconcile keeps order PENDING)
 *
 * Auth model: Flavrly PG has NO Bearer API key. `X-Merchant-Id` (public UUID)
 * creates payments; `X-Merchant-Key` (the merchant webhook secret) reads the
 * private status view and signs webhooks. `utr` is delivered only on the
 * webhook, never on the status response.
 *
 * Security: cfg.webhookSecret (the merchant key) is masked ('***') out of every
 * thrown/logged error text.
 */

export type YoupiConfig = {
  baseUrl: string;
  merchantId: string;
  webhookSecret: string;
  /** Distinct credential for upstream create API; defaults to the existing merchant key. */
  merchantKey?: string;
  receivingVpa?: string;
  dailyLimit?: number;
  maxAmountPaise?: number;
  /** Fail closed on the gateway's actual bound bank receiving account before exposing checkout. */
  requireReceiverMatch?: boolean;
};

export type YoupiVerifyStatus = 'CAPTURED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

const TIMEOUT_MS = 20000;
const MAX_ERR = 200;

/** The merchant key is the only secret in a request; keep it out of all error text. */
function mask(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

/** Mask first, then slice, so a secret straddling the boundary can't leak a prefix. */
function safeMsg(text: string, secret: string): string {
  return mask(text, secret).slice(0, MAX_ERR);
}

function url(cfg: YoupiConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}${path}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** amountPaise comes back as a string on some Flavrly PG responses; coerce safely. */
function toPaise(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
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
  // Flavrly PG wants the amount as an INR string with 2 decimals, not paise.
  const amountInr = (args.amountPaise / 100).toFixed(2);
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
        // The current upstream rejects non-default merchant create without this.
        // Server-to-server ONLY: never expose merchant keys to the browser.
        'X-Merchant-Key': cfg.merchantKey || cfg.webhookSecret,
        // Idempotent on our orderId: a retried create returns the existing session.
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
    });
  } catch (e) {
    throw new Error(safeMsg(`Flavrly PG create failed: ${e instanceof Error ? e.message : String(e)}`, cfg.webhookSecret));
  }
  const text = await res.text().catch(() => '');
  // 200 = existing session returned for an idempotent/ongoing request; 201 = created.
  if (!res.ok) {
    throw new Error(safeMsg(`Flavrly PG create HTTP ${res.status}: ${text}`, cfg.webhookSecret));
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
    throw new Error(safeMsg(`Flavrly PG create: unexpected response: ${text}`, cfg.webhookSecret));
  }
  if (cfg.requireReceiverMatch) {
    // Upstream chooses the receiving account by merchantId, not by the
    // 'receivingVpa' in Flavrly. Never expose a payable checkout URL unless
    // the private session's immutable receiver snapshot agrees.
    if (!cfg.receivingVpa) throw new Error('Flavrly PG: missing verified receiving UPI ID');
    const expectedOrigin = process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
    const checkout = new URL(checkoutUrl);
    if (!expectedOrigin || checkout.protocol !== 'https:' || checkout.origin !== new URL(expectedOrigin).origin) {
      throw new Error('Flavrly PG: checkout origin is not allowlisted');
    }
    let actual: Record<string, unknown>;
    try {
      const probe = await fetch(url(cfg, `/api/v1/payments/${encodeURIComponent(paymentId)}`), {
        method: 'GET',
        headers: { 'X-Merchant-Key': cfg.merchantKey || cfg.webhookSecret },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!probe.ok) throw new Error(`private status HTTP ${probe.status}`);
      actual = (await probe.json()) as Record<string, unknown>;
    } catch {
      throw new Error('Flavrly PG: cannot independently read back receiving account');
    }
    const metadata = actual.metadata as Record<string, unknown> | null;
    const receiver = metadata?.receivingAccountSnapshot as Record<string, unknown> | undefined;
    const actualVpa = typeof receiver?.upiId === 'string' ? receiver.upiId.trim().toLowerCase() : '';
    const actualAmount = toPaise(actual.amountPaise);
    if (
      !actualVpa ||
      actualVpa !== cfg.receivingVpa.trim().toLowerCase() ||
      actual.orderId !== args.orderId ||
      actual.currency !== 'INR' ||
      actualAmount !== args.amountPaise
    ) {
      // A gateway session may already exist but must never be returned to the
      // buyer when bank routing is unknown/mismatched. Operator review required.
      throw new Error('Flavrly PG: gateway receiver, amount, or order identity mismatch');
    }
  }
  return { paymentId, checkoutUrl };
}

function mapStatus(raw: unknown): YoupiVerifyStatus {
  switch (typeof raw === 'string' ? raw.trim().toUpperCase() : '') {
    case 'SUCCESS':
      return 'CAPTURED';
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

export async function getYoupiStatus(
  cfg: YoupiConfig,
  paymentId: string,
): Promise<{ status: YoupiVerifyStatus; utr?: string | null; amountPaise?: number | null }> {
  try {
    const res = await fetch(url(cfg, `/api/v1/payments/${encodeURIComponent(paymentId)}`), {
      method: 'GET',
      // Merchant key unlocks the private view; status is in the public view too.
      headers: { 'X-Merchant-Key': cfg.webhookSecret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'UNKNOWN' };
    const data = (await res.json()) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { status: 'UNKNOWN' };
    return {
      status: mapStatus(data.status),
      // utr is only delivered on the webhook payload, never on the status view.
      utr: str(data.utr) ?? null,
      amountPaise: toPaise(data.amountPaise),
    };
  } catch (e) {
    // Fail safe: never throw into the reconcile loop; log with secret masked.
    console.warn(safeMsg(`Flavrly PG status check failed: ${e instanceof Error ? e.message : String(e)}`, cfg.webhookSecret));
    return { status: 'UNKNOWN' };
  }
}
