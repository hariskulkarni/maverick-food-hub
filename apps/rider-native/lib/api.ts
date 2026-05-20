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

export interface RequestOptions {
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
    const looksLikeHtml =
      typeof body === 'string' && /^\s*<(?:!doctype|html)/i.test(body);
    if (body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string') {
      msg = (body as any).error;
    } else if (res.status >= 500 || res.status === 0 || looksLikeHtml) {
      // A 5xx, or an HTML error page (e.g. nginx 502/503/504 while the API is
      // down or restarting). Never surface raw markup or a bare status code to
      // the rider — give them a calm, actionable message instead.
      msg = "Oak & Sizzler servers are briefly unavailable. Please try again in a moment.";
    } else if (typeof body === 'string' && body.trim() && body.trim().length <= 200) {
      // Some routes (e.g. pool claim) return a short plain-text reason, not JSON.
      msg = body.trim();
    } else {
      msg = `Request failed (${res.status})`;
    }
    throw new ApiError(msg, res.status, body);
  }

  return body as T;
}

/**
 * Authenticated request helper for the feature-bundle API modules
 * (`lib/api-payments.ts`, `lib/api-safety.ts`, `lib/api-dispatch.ts`,
 * `lib/api-growth.ts`). Behaves exactly like the internal `request`: the Bearer
 * token is attached automatically, JSON is parsed in/out, and a failed response
 * throws `ApiError`. Keeping this one shared entry point means feature modules
 * never need to re-implement auth-header plumbing.
 */
export function apiRequest<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>(path, opts);
}

/** Current Bearer token (for modules that build their own fetch, e.g. uploads). */
export function getAuthToken(): string | null {
  return authToken;
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
  /** FLEET riders work the platform-wide pool; DEDICATED belong to one restaurant. */
  riderType: 'FLEET' | 'DEDICATED';
  /** The restaurant a DEDICATED rider belongs to — null for FLEET riders. */
  dedicatedRestaurant: { id: string; name: string } | null;
  /** Profile photo — relative to API_BASE for local storage, absolute for S3, or null. */
  avatarUrl: string | null;
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
  deliveryOtp: string | null; // customer's hand-over code, checked by /deliver
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
  branch: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    line1: string;
    city: string;
    /** The SOURCE restaurant this branch belongs to — where the rider collects. */
    restaurantId: string | null;
    restaurantName: string | null;
  } | null;
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
  notes: string | null; // carries [reached-restaurant ...] / [reached-customer ...] markers
  order: AssignmentOrder;
}

/** A claimable order from the shared pool — GET /api/rider/pool. */
export interface PoolOrder {
  orderId: string;
  code: string;
  restaurant: string;
  branch: string;
  /** Pickup branch street address ("line1, city"), if known. */
  branchAddress: string | null;
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

/** GET /api/rider/earnings — in-app earnings summary. */
export interface EarningsSummary {
  lifetime: {
    totalEarnings: number;
    totalTips: number;
    totalDeliveries: number;
    rating: number;
  };
  today: { earnings: number; deliveries: number };
  recent: {
    id: string;
    orderCode: string;
    deliveredAt: string | null;
    earnings: number;
    base: number;
    tip: number;
  }[];
}

/** A KYC document as returned by GET /api/rider/kyc (numbers are masked). */
export interface KycDoc {
  id: string;
  type: string;
  status: string;
  numberMasked?: string | null;
  numberLast4?: string | null;
  fileUrl: string; // relative to API_BASE for local storage, or absolute for S3
  fileName?: string | null;
  fileMimeType?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
}

export interface KycResponse {
  documents: KycDoc[];
  summary: unknown; // shape varies server-side — the app just lists documents
}

// ─── Rider ⇄ staff messaging ─────────────────────────────────────────────────

/** Who the rider is talking to: their dedicated restaurant's admin, or the platform team. */
export type MessageParty = 'ADMIN' | 'SUPER_ADMIN';

/** A single chat message within a conversation. */
export interface RiderMessage {
  id: string;
  conversationId: string;
  sender: 'RIDER' | 'ADMIN' | 'SUPER_ADMIN';
  senderName: string;
  body: string;
  readByRider: boolean;
  readByStaff: boolean;
  createdAt: string;
}

/** A rider ⇄ staff conversation thread. */
export interface RiderConversation {
  id: string;
  riderId: string;
  party: MessageParty;
  restaurantId: string | null;
  restaurantName: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Messages unread by the rider. */
  unreadCount: number;
  lastMessage: RiderMessage | null;
  messages: RiderMessage[];
  rider: Rider;
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

  // ── Active delivery flow ──────────────────────────────────────────────────
  /** Confirm acceptance (pool claims arrive ACCEPTED already; dispatcher pushes don't). */
  acceptAssignment: (id: string) =>
    request<unknown>(`/api/rider/assignments/${id}/accept`, { method: 'POST' }),
  /** "I'm at the restaurant." Stamps a marker; status stays ACCEPTED. */
  reachRestaurant: (id: string) =>
    request<unknown>(`/api/rider/assignments/${id}/reach-restaurant`, { method: 'POST' }),
  /** "I have the food." → assignment PICKED_UP, order OUT_FOR_DELIVERY. */
  pickup: (id: string) =>
    request<unknown>(`/api/rider/assignments/${id}/pickup`, { method: 'POST' }),
  /** "I'm at the customer's door." Stamps a marker; status stays PICKED_UP. */
  reachCustomer: (id: string) =>
    request<unknown>(`/api/rider/assignments/${id}/reach-customer`, { method: 'POST' }),
  /** Hand-over — verifies the customer's OTP. 400 on mismatch. */
  deliver: (id: string, otp: string) =>
    request<unknown>(`/api/rider/assignments/${id}/deliver`, {
      method: 'POST',
      body: { otp },
    }),

  // ── Live location ─────────────────────────────────────────────────────────
  /** High-frequency GPS ping — fans out to customer + admin trackers via SSE. */
  sendLocation: (lat: number, lng: number, orderId?: string, speedKph?: number) =>
    request<{ ok: true }>('/api/rider/location', {
      method: 'POST',
      body: {
        lat,
        lng,
        ...(orderId ? { orderId } : {}),
        ...(speedKph != null ? { speedKph } : {}),
      },
    }),

  // ── Earnings, push, proof-of-delivery ─────────────────────────────────────
  /** Lifetime + today's earnings and recent delivered runs. */
  earnings: () => request<EarningsSummary>('/api/rider/earnings'),

  /** Register this device's Expo push token so new-order pings reach the rider. */
  registerPushToken: (token: string) =>
    request<{ ok: true }>('/api/rider/push-token', { method: 'POST', body: { token } }),

  /** Multipart upload of the proof-of-delivery photo for an assignment. */
  uploadDeliveryPhoto: async (
    assignmentId: string,
    fileUri: string
  ): Promise<{ url: string }> => {
    const form = new FormData();
    // React Native's FormData accepts this {uri,name,type} shape for file parts.
    form.append('photo', { uri: fileUri, name: 'delivery.jpg', type: 'image/jpeg' } as any);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    // No Content-Type header — fetch sets the multipart boundary itself.
    const res = await fetch(`${API_BASE}/api/rider/assignments/${assignmentId}/photo`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `Photo upload failed (${res.status})`, res.status, text);
    }
    return res.json();
  },

  /**
   * Multipart upload of the rider's profile photo. Updates User.avatarUrl
   * server-side and returns the saved URL (relative for local storage,
   * absolute for S3).
   */
  uploadAvatar: async (fileUri: string): Promise<{ avatarUrl: string }> => {
    const form = new FormData();
    // React Native's FormData accepts this {uri,name,type} shape for file parts.
    form.append('photo', { uri: fileUri, name: 'avatar.jpg', type: 'image/jpeg' } as any);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    // No Content-Type header — fetch sets the multipart boundary itself.
    const res = await fetch(`${API_BASE}/api/rider/avatar`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `Avatar upload failed (${res.status})`, res.status, text);
    }
    return res.json();
  },

  // ── Rider ⇄ staff messaging ───────────────────────────────────────────────
  /** All of the rider's conversations (with their restaurant admin and the platform team). */
  conversations: () =>
    request<{ conversations: RiderConversation[] }>('/api/rider/messages'),

  /** A single conversation thread — marks staff messages read. */
  conversation: (id: string) =>
    request<{ conversation: RiderConversation }>(`/api/rider/messages/${id}`),

  /** Start (or append to) a conversation with a party. 409 if ADMIN with no dedicated restaurant. */
  sendMessageToParty: (party: MessageParty, body: string) =>
    request<{ conversation: RiderConversation }>('/api/rider/messages', {
      method: 'POST',
      body: { party, body },
    }),

  /** Reply within an existing conversation thread. */
  replyToConversation: (id: string, body: string) =>
    request<{ conversation: RiderConversation }>(`/api/rider/messages/${id}`, {
      method: 'POST',
      body: { body },
    }),

  // ── Profile & KYC ─────────────────────────────────────────────────────────
  /** Rider's KYC documents (masked) + status summary. */
  kyc: () => request<KycResponse>('/api/rider/kyc'),

  /** Self-service profile edit — name / email. */
  updateProfile: (patch: { name?: string; email?: string | null }) =>
    request<{ ok: true; profile: { name: string | null; email: string | null } }>(
      '/api/rider/profile',
      { method: 'PATCH', body: patch }
    ),

  /** Raw CSV text of the rider's earnings statement, for in-app export/sharing. */
  fetchStatementText: async (): Promise<string> => {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_BASE}/api/rider/reports/statement?format=csv`, {
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `Could not fetch statement (${res.status})`, res.status, text);
    }
    return res.text();
  },

  // ── Batch invitations (mid-delivery "add this order to your route?") ──────
  /** Currently-pending batch invitations for this rider. */
  batchInvitations: () =>
    request<{ invitations: BatchInvitation[] }>('/api/rider/batch-invitations'),

  /** Accept a batch invitation by id. */
  acceptBatchInvitation: (id: string) =>
    request<{ ok: true; assignmentId: string; orderId: string }>(
      `/api/rider/batch-invitations/${id}/accept`,
      { method: 'POST' }
    ),

  /** Decline a batch invitation by id, with an optional free-text reason. */
  declineBatchInvitation: (id: string, reason?: string) =>
    request<{ ok: true; status: string; noop?: boolean }>(
      `/api/rider/batch-invitations/${id}/decline`,
      { method: 'POST', body: reason ? { reason } : undefined }
    ),
};

/**
 * A pending batch invitation, as returned by GET /api/rider/batch-invitations.
 * Mirrors the SerializedBatchInvitation shape on the server side — keep in
 * sync with `apps/web/src/app/api/rider/batch-invitations/_helpers.ts`.
 */
export interface BatchInvitation {
  id: string;
  orderId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
  detourKm: number;
  extraEarnings: number;
  pickupEtaMin: number | null;
  invitedAt: string;
  expiresAt: string;
  secondsLeft: number;
  order: {
    code: string;
    total: number;
    branchName: string;
    customerArea: string;
  };
}
