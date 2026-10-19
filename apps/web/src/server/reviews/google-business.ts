/**
 * Google Business Profile adapter (read reviews + post replies) over fetch.
 *
 * Auth model: OAuth 2.0 with the business owner's consent (scope
 * business.manage). We persist only the refresh token (encrypted, via the
 * IntegrationCredential store); access tokens are short-lived and fetched on
 * demand — never persisted in plaintext.
 *
 * Reviews + replies use the Google My Business v4 reviews surface:
 *   GET  https://mybusiness.googleapis.com/v4/{account}/{location}/reviews
 *   PUT  https://mybusiness.googleapis.com/v4/{review}/reply   { comment }
 */
import { getConfig } from '@/server/integrations';
import { log } from '@/server/log';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MBAPI = 'https://mybusiness.googleapis.com/v4';

export type NormalizedReview = {
  googleReviewId: string; reviewerName: string | null; rating: number;
  comment: string | null; reviewCreatedAt: Date;
};

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

export async function listReviews(restaurantId: string): Promise<NormalizedReview[]> {
  const cfg = await cfgOrThrow(restaurantId, { requireAccount: true });
  const token = await accessToken(cfg.refreshToken);
  const res = await fetch(`${MBAPI}/${cfg.accountId}/${cfg.locationId}/reviews`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google reviews ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  return reviews.map((r: any) => ({
    googleReviewId: String(r.name),
    reviewerName: r.reviewer?.displayName ?? null,
    rating: STAR[r.starRating] ?? 0,
    comment: r.comment ?? null,
    reviewCreatedAt: new Date(r.createTime ?? Date.now()),
  }));
}

export async function postReply(restaurantId: string, googleReviewId: string, text: string): Promise<void> {
  const cfg = await cfgOrThrow(restaurantId);
  const token = await accessToken(cfg.refreshToken);
  const res = await fetch(`${MBAPI}/${googleReviewId}/reply`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comment: text }),
  });
  if (!res.ok) throw new Error(`google reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
  log.info('reviews.google.replied', { restaurantId, googleReviewId });
}
