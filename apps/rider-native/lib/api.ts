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
    let msg: string;
    if (body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string') {
      msg = (body as any).error;
    } else if (typeof body === 'string' && body.trim()) {
      // Some routes (e.g. pool claim) return a plain-text reason, not JSON.
      msg = body.trim();
    } else {
      msg = `Request failed (${res.status})`;
    }
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

/** What POST /api/rider/online returns — the updated rider profile row. */
export interface RiderProfileRow {
  id: string;
  isOnline: boolean;
  currentLoad: number;
  rating: number;
  totalDeliveries: number;
}

export type AssignmentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'REJECTED'
  | 'CANCELLED';

/** The order attached to an assignment — only the fields the app reads. */
export interface AssignmentOrder {
  id: string;
  code: string;
  status: string;
  total: string; // Prisma Decimal → JSON string
  currency: string;
  customerNotes: string | null;
  placedAt: string;
  items: { id: string; quantity: number }[];
  customer: { id: string; name: string | null; phone: string | null } | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  branch: { id: string; name: string } | null;
}

export interface Assignment {
  id: string;
  orderId: string;
  status: AssignmentStatus;
  earningsAmt: string; // Prisma Decimal → JSON string
  baseEarningsAmt: string;
  tipAmt: string;
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  order: AssignmentOrder;
}

/** A claimable order from the shared pool — GET /api/rider/pool. */
export interface PoolOrder {
  orderId: string;
  code: string;
  restaurant: string;
  branch: string;
  branchLoc: { lat: number; lng: number } | null;
  delivery: { line: string; lat: number | null; lng: number | null } | null;
  itemSummary: string; // "2× Margherita, 1× Garlic Bread"
  total: number;
  payout: number; // what the rider earns if they claim
  distanceKm: number;
  readyAt: string | null;
}

/** POST /api/rider/pool/[id]/claim — the freshly created assignment row. */
export interface ClaimResult {
  id: string;
  orderId: string;
  status: AssignmentStatus;
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

  /** Lightweight self-status — online flag + last heartbeat. */
  me: () => request<RiderMe>('/api/rider/me'),

  /** Flip the rider online / offline. */
  setOnline: (online: boolean) =>
    request<RiderProfileRow>('/api/rider/online', { method: 'POST', body: { online } }),

  /** Active assignments (PENDING / ACCEPTED / PICKED_UP) with full order detail. */
  assignments: () => request<Assignment[]>('/api/rider/assignments'),

  /** Liveness ping — sent every ~30s while online so the server doesn't auto-offline us. */
  heartbeat: () =>
    request<null>('/api/rider/heartbeat', { method: 'POST', body: { gpsEnabled: true } }),

  /** Claimable orders from the shared pool (READY, unclaimed, platform-wide). */
  pool: () => request<PoolOrder[]>('/api/rider/pool'),

  /** Claim a pool order — 409 if another rider grabbed it first, 400 if offline. */
  claimOrder: (orderId: string) =>
    request<ClaimResult>(`/api/rider/pool/${orderId}/claim`, { method: 'POST' }),
};
