/**
 * Exotel adapter — "Connect two numbers" (click-to-call) for masked calling.
 *
 * Official docs (verified 2026-10-27):
 *   - https://developer.exotel.com/api/make-a-call-api
 *   - https://developer.exotel.com/docs/voice-v1/api-reference/connect-two-numbers
 *   - https://developer.exotel.com/docs/voice-v1/api-reference/status-callback
 *   - https://developer.exotel.com/docs/voice-v1/quickstart
 *   - https://developer.exotel.com/docs/references/webhooks
 *
 *   POST https://<subdomain>/v1/Accounts/<sid>/Calls/connect
 *     subdomain: api.exotel.com (Singapore) | api.in.exotel.com (Mumbai, India accounts)
 *     auth: HTTP Basic <api_key>:<api_token>
 *     body (application/x-www-form-urlencoded):
 *       From       E.164 — rung first (our rider)
 *       To         E.164 — connected after From answers (our customer)
 *       CallerId   the ExoPhone (virtual number) both parties see
 *       CallType   "trans" (transactional)
 *       TimeLimit  max call duration in seconds (max 14400)
 *       StatusCallback / StatusCallbackEvents (terminal, answered) /
 *       StatusCallbackContentType (application/json | multipart/form-data)
 *       CustomField (≤128 chars) — we send our CallLog id
 *     response: { Call: { Sid, Status: queued|in-progress|completed|failed|busy|no-answer, … } }
 *     errors:   { RestException: { Status, Message } }; 429 = 200 req/min limit
 *
 *   Status callback: POST to our URL with CallSid, Status, DateUpdated,
 *   RecordingUrl (+ EventType, StartTime, EndTime, ConversationDuration, Legs[]
 *   {OnCallDuration, Status, AnsweredBy}, CustomField when StatusCallbackEvents
 *   is set). Exotel documents NO signature on callbacks, so the callback URL we
 *   hand Exotel carries a per-call HMAC token (see callbackSignature) and the
 *   handler can additionally enforce an IP allow-list.
 *
 * Secrets (EXOTEL_API_KEY / EXOTEL_API_TOKEN) never leave this module except
 * inside the Authorization header, and are never logged. Phone numbers are
 * sent to Exotel only — never logged and never returned from this module.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CallLogStatus } from '@prisma/client';
import type { ConnectCallRequest, ConnectCallResult, TelephonyProvider } from './types';
import { redactPhones } from './phone';

export interface ExotelConfig {
  sid: string;
  apiKey: string;
  apiToken: string;
  /** Host only, e.g. "api.exotel.com" or "api.in.exotel.com". */
  subdomain: string;
  /** The ExoPhone (virtual number) shown to both parties. */
  callerId: string;
  /** Max call length in seconds (EXOTEL_CALL_TIME_LIMIT_SEC, default 180). */
  timeLimitSec: number;
}

export const EXOTEL_DEFAULT_TIME_LIMIT_SEC = 180;
const EXOTEL_MAX_TIME_LIMIT_SEC = 14_400;
const REQUEST_TIMEOUT_MS = 10_000;

/** Only real Exotel API hosts — the credentials must never be sent elsewhere. */
const EXOTEL_HOST = /^(?:[a-z0-9-]+\.)*exotel\.com$/;

type Env = Record<string, string | undefined>;

/**
 * Read the Exotel config from env. Returns null (feature off → 503 at the API)
 * when any required value is missing or the subdomain isn't an exotel.com host.
 */
export function readExotelConfig(env: Env = process.env): ExotelConfig | null {
  const sid = env.EXOTEL_SID?.trim();
  const apiKey = env.EXOTEL_API_KEY?.trim();
  const apiToken = env.EXOTEL_API_TOKEN?.trim();
  const callerId = env.EXOTEL_CALLER_ID?.trim();
  const subdomain = (env.EXOTEL_SUBDOMAIN?.trim() || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!sid || !apiKey || !apiToken || !callerId || !subdomain) return null;
  if (!EXOTEL_HOST.test(subdomain)) return null;
  const raw = Number.parseInt(env.EXOTEL_CALL_TIME_LIMIT_SEC ?? '', 10);
  const timeLimitSec =
    Number.isFinite(raw) && raw > 0 ? Math.min(raw, EXOTEL_MAX_TIME_LIMIT_SEC) : EXOTEL_DEFAULT_TIME_LIMIT_SEC;
  return { sid, apiKey, apiToken, subdomain, callerId, timeLimitSec };
}

/** The exact HTTP request for Calls/connect. Pure — exported for tests. */
export function buildConnectRequest(
  cfg: ExotelConfig,
  req: ConnectCallRequest
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const url = `https://${cfg.subdomain}/v1/Accounts/${encodeURIComponent(cfg.sid)}/Calls/connect`;
  const form = new URLSearchParams();
  form.set('From', req.from);
  form.set('To', req.to);
  form.set('CallerId', cfg.callerId);
  form.set('CallType', 'trans');
  form.set('TimeLimit', String(cfg.timeLimitSec));
  if (req.correlationId) form.set('CustomField', req.correlationId.slice(0, 128));
  if (req.statusCallbackUrl) {
    form.set('StatusCallback', req.statusCallbackUrl);
    // Ask for the extended payload (ConversationDuration, Legs, …) on hang-up.
    form.set('StatusCallbackEvents[0]', 'terminal');
    form.set('StatusCallbackContentType', 'application/json');
  }
  const basic = Buffer.from(`${cfg.apiKey}:${cfg.apiToken}`).toString('base64');
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    },
  };
}

/** Exotel call / leg status → our CallLogStatus. Unknown values → null. */
export function mapExotelStatus(s: unknown): CallLogStatus | null {
  switch (String(s ?? '').trim().toLowerCase()) {
    case 'queued':
      return 'QUEUED';
    case 'ringing':
    case 'in-progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'busy':
      return 'BUSY';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'failed':
      return 'FAILED';
    case 'canceled':
    case 'cancelled':
      return 'CANCELED';
    default:
      return null;
  }
}

export const TERMINAL_CALL_STATUSES: ReadonlySet<CallLogStatus> = new Set([
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'FAILED',
  'CANCELED',
]);

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function createExotelProvider(cfg: ExotelConfig, fetchImpl: FetchLike = fetch): TelephonyProvider {
  return {
    name: 'exotel',
    async connectCall(req: ConnectCallRequest): Promise<ConnectCallResult> {
      const { url, init } = buildConnectRequest(cfg, req);
      let res: Response;
      try {
        // No automatic retry: Calls/connect is not idempotent — a retry after a
        // timeout could ring the rider twice. The rider can tap again.
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        return { ok: false, httpStatus: 0, reason: timedOut ? 'exotel_timeout' : 'exotel_network_error' };
      }
      const text = await res.text().catch(() => '');
      type ExotelBody = {
        Call?: { Sid?: unknown; Status?: unknown };
        RestException?: { Message?: string; message?: string };
      } | null;
      let body: ExotelBody = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        const msg = body?.RestException?.Message ?? body?.RestException?.message ?? '';
        return { ok: false, httpStatus: res.status, reason: redactPhones(`exotel_http_${res.status}${msg ? `: ${msg}` : ''}`) };
      }
      const sid = body?.Call?.Sid;
      if (typeof sid !== 'string' || !sid) {
        return { ok: false, httpStatus: res.status, reason: 'exotel_unexpected_response' };
      }
      return { ok: true, providerCallSid: sid, status: mapExotelStatus(body?.Call?.Status) ?? 'QUEUED' };
    },
  };
}

// ─── Status callback authenticity ───────────────────────────────────────────

/**
 * Per-call callback token: HMAC-SHA256(callLogId) keyed by a secret derived
 * from EXOTEL_API_TOKEN (or EXOTEL_STATUS_CALLBACK_SECRET when set). Binding the
 * token to the CallLog id means a leaked URL can only ever touch that one row.
 */
function callbackKey(env: Env): string | null {
  const explicit = env.EXOTEL_STATUS_CALLBACK_SECRET?.trim();
  if (explicit) return explicit;
  const token = env.EXOTEL_API_TOKEN?.trim();
  return token ? `exotel-status-callback:v1:${token}` : null;
}

export function callbackSignature(callLogId: string, env: Env = process.env): string | null {
  const key = callbackKey(env);
  if (!key) return null;
  return createHmac('sha256', key).update(callLogId).digest('hex');
}

export function verifyCallbackSignature(callLogId: string, sig: string | null | undefined, env: Env = process.env): boolean {
  const expected = callbackSignature(callLogId, env);
  if (!expected || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Absolute status-callback URL for a CallLog row, or null when no public base
 * URL is configured (EXOTEL_STATUS_CALLBACK_BASE_URL, else NEXTAUTH_URL).
 */
export function statusCallbackUrl(callLogId: string, env: Env = process.env): string | null {
  const base = (env.EXOTEL_STATUS_CALLBACK_BASE_URL || env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '');
  const sig = callbackSignature(callLogId, env);
  if (!base || !/^https?:\/\//i.test(base) || !sig) return null;
  const q = new URLSearchParams({ cl: callLogId, sig });
  return `${base}/api/telephony/exotel/status?${q.toString()}`;
}

/** Optional comma-separated IP allow-list (EXOTEL_CALLBACK_IP_ALLOWLIST). Empty = allow all. */
export function callbackIpAllowed(ip: string | null | undefined, env: Env = process.env): boolean {
  const list = (env.EXOTEL_CALLBACK_IP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  return !!ip && list.includes(ip);
}

// ─── Status callback payload ────────────────────────────────────────────────

export interface ExotelStatusEvent {
  callSid: string | null;
  status: CallLogStatus | null;
  eventType: 'terminal' | 'answered' | null;
  durationSec: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  riderLegStatus: string | null;
  customerLegStatus: string | null;
}

/**
 * Exotel timestamps are "YYYY-MM-DD HH:mm:ss" without an offset. We treat them
 * as IST (+05:30), the zone Exotel India accounts report in; an ISO string with
 * an explicit offset is honoured as-is. Unparseable → null.
 */
export function parseExotelTime(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(s);
  const d = m ? new Date(`${m[1]}T${m[2]}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null;
}

/** Normalise a status-callback body (JSON or form fields) — keeps no numbers. */
export function parseStatusCallback(body: Record<string, unknown>): ExotelStatusEvent {
  const legs = Array.isArray(body.Legs) ? (body.Legs as Array<Record<string, unknown>>) : [];
  const dur = Number(body.ConversationDuration);
  const ev = String(body.EventType ?? '').toLowerCase();
  return {
    callSid: str(body.CallSid) ?? null,
    status: mapExotelStatus(body.Status),
    eventType: ev === 'terminal' || ev === 'answered' ? ev : null,
    durationSec: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null,
    startedAt: parseExotelTime(body.StartTime),
    endedAt: parseExotelTime(body.EndTime),
    // Leg 1 = From (rider), leg 2 = To (customer) — the order Exotel dials them.
    riderLegStatus: str(legs[0]?.Status),
    customerLegStatus: str(legs[1]?.Status),
  };
}
