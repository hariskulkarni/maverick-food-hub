import { NextRequest } from 'next/server';
import { requireManagedRestaurant, tenantAdminOrError } from '@/server/tenancy';
import { exchangeCode, listAccounts, listAllLocations } from '@/server/reviews/google-business';
import { saveConfig } from '@/server/integrations';
import { verifyState } from '@/server/reviews/oauth-state';
import { externalBaseUrl } from '@/server/http/external-url';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google Business OAuth callback.
 *
 * Observable + hardened: every failure (lost session, state mismatch, token
 * exchange error, save error) is LOGGED server-side and surfaced back to the
 * admin as `/admin/settings?tab=reviews&google=connect_error&why=<reason>`
 * instead of throwing an opaque 500. When the OAuth succeeds but Google returns
 * no Business Profile accounts/locations (project lacks Business Profile API
 * access, or the account owns no verified listing), the token is still saved
 * (status CONNECTED) and the reason is carried on `google=needs_location&why=`.
 * The redirect base is the public host the browser used (never the internal
 * localhost the nginx upstream reports).
 */
function settingsRedirect(base: string, params: string): Response {
  return Response.redirect(new URL(`/admin/settings?tab=reviews&${params}`, base), 302);
}

export async function GET(req: NextRequest) {
  const base = externalBaseUrl(req.headers);
  // Security preconditions reject HARD (403) and never redirect or save — a
  // tampered/absent state, a missing code, or a cross-restaurant state binding
  // is not a user-recoverable condition.
  const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
  if (restaurant instanceof Response) return restaurant;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';
  if (!code || !verifyState(state, restaurant.id)) return new Response('Forbidden', { status: 403 });

  try {

    const { refreshToken } = await exchangeCode(code);

    // Discovery is best-effort: a transient/permission failure must not lose the
    // token. Capture WHY so the admin sees it (API access vs no Business Profile).
    let accountId = '';
    let locs: Array<{ id: string; title: string }> = [];
    let discoveryWhy = '';
    try {
      accountId = await listAccounts(refreshToken);
      if (accountId) locs = await listAllLocations(refreshToken, accountId);
      else discoveryWhy = 'no_business_account'; // OAuth ok, but this Google account owns no Business Profile
    } catch (e) {
      discoveryWhy = e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 140) : 'discovery_failed';
      log.warn({ err: discoveryWhy }, '[gbp-callback] account/location discovery failed — token saved, no locations');
      locs = [];
    }

    const locationId = locs.length === 1 ? locs[0].id : '';
    await saveConfig(
      restaurant.id, 'GOOGLE_BUSINESS' as any,
      { refreshToken, accountId, locationId, locations: JSON.stringify(locs) },
      { status: 'CONNECTED' },
    );

    if (locs.length === 0) {
      return settingsRedirect(base, `google=needs_location${discoveryWhy ? `&why=${encodeURIComponent(discoveryWhy)}` : ''}`);
    }
    if (locs.length === 1) return settingsRedirect(base, 'google=connected');
    return settingsRedirect(base, 'pickLocation=1');
  } catch (e) {
    // requireManagedRestaurant throws a Response (no session / no managed
    // restaurant); exchangeCode / saveConfig throw Errors (Google token error,
    // crypto/db error). Surface a short reason + log the detail.
    const why = e instanceof Response
      ? `auth_${e.status}`
      : e instanceof Error
        ? e.message.replace(/\s+/g, ' ').slice(0, 140)
        : 'unknown';
    log.error({ err: e instanceof Error ? e.message : String(e) }, '[gbp-callback] connect failed');
    return settingsRedirect(base, `google=connect_error&why=${encodeURIComponent(why)}`);
  }
}
