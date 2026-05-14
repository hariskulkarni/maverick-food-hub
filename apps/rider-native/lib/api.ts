/**
 * API client for the Oak & Sizzler rider app.
 *
 * Talks to the web backend's /api/rider/* endpoints. The Bearer token is held
 * in a module-level variable (set by lib/auth.ts on sign-in / app launch) and
 * attached automatically to every request — so screens never deal with auth
 * headers directly.
 *
 * NOTE: API_BASE is the raw VPS IP for now. Once oakandsizzler.com has DNS +
 * SSL, change this one line to https://oakandsizzler.com and rebuild.
 */

export const API_BASE = 'http://148.230.66.124';

let authToken: string | null = null;

/** Called by lib/auth.ts whenever the token changes (sign-in, restore, sign-out). */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (used by the login endpoints). */
  noAuth?: boolean;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.noAuth && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // Network-level failure (no connectivity, server unreachable).
    throw new ApiError('Network error — check your connection.', 0, null);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string'
        ? (body as any).error
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }

  return body as T;
}

// ─── Typed response shapes ───────────────────────────────────────────────────

export interface Rider {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface RequestOtpResponse {
  ok: true;
  /** Present only when the backend has OTP_DEBUG_LOG=true (demo / pre-SMS). */
  devCode?: string;
}

export interface VerifyOtpResponse {
  token: string;
  rider: Rider;
}

export interface RiderMe {
  online: boolean;
  lastSeenAt: string | null;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const api = {
  /** Step 1 of login — sends an OTP, rider-gated. */
  requestOtp: (phone: string) =>
    request<RequestOtpResponse>('/api/rider/auth/request-otp', {
      method: 'POST',
      body: { phone },
      noAuth: true,
    }),

  /** Step 2 of login — verifies the OTP, returns a Bearer token. */
  verifyOtp: (phone: string, code: string) =>
    request<VerifyOtpResponse>('/api/rider/auth/verify-otp', {
      method: 'POST',
      body: { phone, code },
      noAuth: true,
    }),

  /** Lightweight self-status — proves the Bearer token works. */
  me: () => request<RiderMe>('/api/rider/me'),
};
