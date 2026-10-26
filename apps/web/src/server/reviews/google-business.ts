/**
 * Google Business Profile adapter (read reviews + post replies) over fetch.
 *
 * Auth model: OAuth 2.0 with the business owner's consent (scope
 * business.manage). We persist only the refresh token (encrypted, via the
 * IntegrationCredential store); access tokens are short-lived and fetched on
 * demand — never persisted in plaintext.
 *
 * Reviews + replies use the Google My Business v4 reviews surface:
 *   GET  https://mybusiness.googleapis.com/v4/{account}/{location}/reviews (paginated, nextPageToken)
 *   PUT  https://mybusiness.googleapis.com/v4/{review}/reply   { comment }
 */
import { getConfig } from '@/server/integrations';
import { log } from '@/server/log';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MBAPI = 'https://mybusiness.googleapis.com/v4';

export type ReviewMedia = { url: string; thumbnailUrl: string | null; type: string };

/** GBP reply metadata (2026 fields). All optional: Google omits what does not apply. */
export type ReplyMeta = {
  moderationState: string | null; policyViolation: string | null; reviewReplyUrl: string | null;
};

export type ExistingReply = ReplyMeta & { comment: string; updateTime: Date | null };

export type NormalizedReview = {
  googleReviewId: string; reviewerName: string | null; rating: number;
  comment: string | null; reviewCreatedAt: Date;
  /** 'gbp' (default) or 'places'. */
  source?: 'gbp' | 'places';
  /** Google updateTime — differs from createTime when the reviewer edited. */
  reviewUpdatedAt?: Date | null;
  media?: ReviewMedia[];
  /** A reply that already exists on Google (posted in Google's UI or elsewhere). */
  existingReply?: ExistingReply | null;
};

/**
 * A Google API failure. `safeMessage` is owner-facing and never contains the
 * upstream body; `message` keeps a short body for server logs only.
 */
export class GoogleApiError extends Error {
  constructor(public status: number, public safeMessage: string, detail: string) {
    super(detail);
    this.name = 'GoogleApiError';
  }
}

export function safeGoogleMessage(status: number): string {
  if (status === 400) return 'Google rejected the reply. Check the text and try again.';
  if (status === 401 || status === 403) return 'Google denied access. Reconnect Google Business in Settings.';
  if (status === 404) return 'This review no longer exists on Google.';
  if (status === 429) return 'Google rate limit reached. Try again in a few minutes.';
  return 'Google is unavailable right now. Try again later.';
}

/** Owner-facing message for any error thrown while talking to Google. */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof GoogleApiError) return e.safeMessage;
  if (e instanceof Error && /not connected/i.test(e.message)) return 'Google Business not connected';
  return 'Could not reach Google. Try again later.';
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getOAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: env('GOOGLE_OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_OAUTH_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.refresh_token) throw new Error('google: no refresh_token (re-consent with prompt=consent)');
  return { refreshToken: data.refresh_token };
}

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('google refresh: no access_token in response');
  return data.access_token as string;
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function cfgOrThrow(restaurantId: string, { requireAccount = false } = {}) {
  const cfg = await getConfig(restaurantId, 'GOOGLE_BUSINESS' as any);
  if (!cfg?.refreshToken || !cfg?.locationId || (requireAccount && !cfg?.accountId)) {
    throw new Error('Google Business not connected');
  }
  return cfg as { refreshToken: string; accountId?: string; locationId: string };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** policyViolation may arrive as a string or an object ({ type, description, ... }). */
function violationText(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 300);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const t = str(o.description) ?? str(o.reason) ?? str(o.type) ?? str(o.policy);
    return (t ?? JSON.stringify(o)).slice(0, 300);
  }
  return null;
}

export function parseReplyMeta(r: any): ReplyMeta {
  return {
    moderationState: str(r?.moderationState) ?? str(r?.state) ?? null,
    policyViolation: violationText(r?.policyViolation),
    reviewReplyUrl: str(r?.reviewReplyUrl) ?? null,
  };
}

function parseMedia(r: any): ReviewMedia[] {
  const raw = [r?.reviewMedia, r?.media, r?.mediaItems].find(Array.isArray) as any[] | undefined;
  if (!raw) return [];
  return raw
    .map((m) => ({
      url: str(m?.googleUrl) ?? str(m?.sourceUrl) ?? str(m?.url) ?? '',
      thumbnailUrl: str(m?.thumbnailUrl),
      type: str(m?.mediaFormat) ?? str(m?.type) ?? 'PHOTO',
    }))
    .filter((m) => /^https:\/\//.test(m.url))
    .slice(0, 10);
}

export function normalizeGbpReview(r: any): NormalizedReview {
  const reply = r?.reviewReply;
  return {
    googleReviewId: String(r.name),
    reviewerName: r.reviewer?.displayName ?? null,
    rating: STAR[r.starRating] ?? 0,
    comment: r.comment ?? null,
    reviewCreatedAt: new Date(r.createTime ?? Date.now()),
    reviewUpdatedAt: r.updateTime ? new Date(r.updateTime) : null,
    media: parseMedia(r),
    existingReply: reply && typeof reply.comment === 'string' && reply.comment.trim()
      ? { comment: reply.comment, updateTime: reply.updateTime ? new Date(reply.updateTime) : null, ...parseReplyMeta(reply) }
      : null,
  };
}

/** Upper bound on pages per sync (50 reviews/page) so a runaway token can't loop forever. */
export const MAX_REVIEW_PAGES = 40;

export type ReviewFetch = {
  reviews: NormalizedReview[]; averageRating: number | null; totalReviewCount: number | null;
};

/**
 * Reviews for the connected location (newest update first), following
 * nextPageToken, plus Google's location totals. With `stopBefore`, paging stops
 * after the first page whose oldest review was last updated before that time
 * (incremental sync); without it, every page is read (full sync).
 */
export async function fetchReviews(restaurantId: string, opts: { stopBefore?: Date } = {}): Promise<ReviewFetch> {
  const cfg = await cfgOrThrow(restaurantId, { requireAccount: true });
  const token = await accessToken(cfg.refreshToken);
  const out: NormalizedReview[] = [];
  let averageRating: number | null = null;
  let totalReviewCount: number | null = null;
  let pageToken = '';
  for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
    const qs = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await fetch(`${MBAPI}/${cfg.accountId}/${cfg.locationId}/reviews?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new GoogleApiError(res.status, safeGoogleMessage(res.status), `google reviews ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    if (page === 0) {
      averageRating = typeof data?.averageRating === 'number' ? data.averageRating : null;
      totalReviewCount = typeof data?.totalReviewCount === 'number' ? data.totalReviewCount : null;
    }
    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
    const normalized: NormalizedReview[] = reviews.map(normalizeGbpReview);
    out.push(...normalized);
    pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
    if (!pageToken) break;
    const last = normalized[normalized.length - 1];
    if (opts.stopBefore && last && (last.reviewUpdatedAt ?? last.reviewCreatedAt) < opts.stopBefore) break;
  }
  return { reviews: out, averageRating, totalReviewCount };
}

export async function listReviews(restaurantId: string): Promise<NormalizedReview[]> {
  return (await fetchReviews(restaurantId)).reviews;
}

/** PUT the reply; returns Google's moderation metadata for the stored reply. */
export async function postReply(restaurantId: string, googleReviewId: string, text: string): Promise<ReplyMeta> {
  const cfg = await cfgOrThrow(restaurantId);
  const token = await accessToken(cfg.refreshToken);
  const res = await fetch(`${MBAPI}/${googleReviewId}/reply`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comment: text }),
  });
  if (!res.ok) {
    throw new GoogleApiError(res.status, safeGoogleMessage(res.status), `google reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  log.info({ restaurantId, googleReviewId }, 'reviews.google.replied');
  return parseReplyMeta(data);
}

const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const BIZINFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';

/** First account resource name (e.g. 'accounts/123'), or '' if none. */
export async function listAccounts(refreshToken: string): Promise<string> {
  const token = await accessToken(refreshToken);
  const res = await fetch(ACCOUNTS_URL, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`google accounts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data?.accounts?.[0]?.name ?? '');
}

/** First location resource name (e.g. 'locations/456') under `account`, or '' if none. */
export async function listLocations(refreshToken: string, account: string): Promise<string> {
  const token = await accessToken(refreshToken);
  const res = await fetch(`${BIZINFO}/${account}/locations?readMask=name`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google locations ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data?.locations?.[0]?.name ?? '');
}

/** All locations under `account` as { id: full resource name, title }. */
export async function listAllLocations(
  refreshToken: string, account: string,
): Promise<Array<{ id: string; title: string }>> {
  const token = await accessToken(refreshToken);
  const res = await fetch(`${BIZINFO}/${account}/locations?readMask=name,title&pageSize=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google locations ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const locs = Array.isArray(data?.locations) ? data.locations : [];
  return locs
    .filter((l: any) => l?.name)
    .map((l: any) => ({ id: String(l.name), title: String(l.displayName ?? l.title ?? l.name) }));
}

/** Single-location happy path: first account, first location. Empty strings if not found. */
export async function discoverAccountAndLocation(
  refreshToken: string,
): Promise<{ accountId: string; locationId: string }> {
  const accountId = await listAccounts(refreshToken);
  if (!accountId) return { accountId: '', locationId: '' };
  const locationId = await listLocations(refreshToken, accountId);
  return { accountId, locationId };
}
