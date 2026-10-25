/**
 * Client fetch helper for the rider web portal (/rider).
 *
 * Calls the SAME /api/rider/* endpoints the native app uses. Auth rides on the
 * httpOnly rider cookie (credentials: 'same-origin'), never on a JS-visible
 * token. A 401 from any rider endpoint means the session ended (signed in on
 * the app, logged out, suspended…) → bounce to the login page.
 */
export class PortalApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = 'PortalApiError';
  }
}

export const SESSION_ENDED_URL = '/rider/login?reason=expired';

/** Turn a failed response body into calm, human copy (mirrors rider-native lib/api.ts). */
export function errorMessage(status: number, body: unknown): string {
  const looksLikeHtml = typeof body === 'string' && /^\s*<(?:!doctype|html)/i.test(body);
  const err = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const msg = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  if (typeof err === 'string' && /^[a-z0-9_-]+$/.test(err) && typeof msg === 'string' && msg) return msg;
  if (typeof err === 'string' && err) return err;
  if (status >= 500 || status === 0 || looksLikeHtml) return 'Flavrly servers are briefly unavailable. Please try again in a moment.';
  if (typeof body === 'string' && body.trim() && body.trim().length <= 300) return body.trim();
  return `Request failed (${status})`;
}

function onSessionEnded() {
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/rider/login')) {
    window.location.assign(SESSION_ENDED_URL);
  }
}

export async function riderApi<T = unknown>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? 'GET', headers, body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new PortalApiError('Network error — check your connection.', 0, null);
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (res.status === 401 && path.startsWith('/api/rider/')) {
    onSessionEnded();
    throw new PortalApiError('Your session has ended. Please sign in again.', 401, parsed);
  }
  if (!res.ok) throw new PortalApiError(errorMessage(res.status, parsed), res.status, parsed);
  return parsed as T;
}

/** ₹1,234 / ₹12.50 */
export function rupees(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: v % 1 === 0 ? 0 : 2, minimumFractionDigits: v % 1 === 0 ? 0 : 2 })}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
