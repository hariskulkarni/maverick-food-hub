/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Maintenance mode · path policy
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Pure, dependency-free, Edge-safe. Lives apart from `server/maintenance.ts`
 *  (which reaches the database) so Edge middleware can import the policy
 *  without dragging Prisma into the Edge bundle, and so the rules are unit
 *  testable without a database.
 */

/** Cookie carrying a valid bypass token. */
export const MAINTENANCE_BYPASS_COOKIE = 'flavrly_maintenance_bypass';

/** Scope string embedded in bypass tokens, so a token minted for another gate won't work here. */
export const MAINTENANCE_BYPASS_SCOPE = 'maintenance-bypass';

/** Default bypass lifetime: long enough to verify a deploy, short enough to not linger. */
export const MAINTENANCE_BYPASS_TTL_SECONDS = 12 * 60 * 60;

/** The holding page, and the route that claims a bypass token. */
export const UNDER_CONSTRUCTION_PATH = '/under-construction';
export const MAINTENANCE_BYPASS_PATH = '/maintenance-bypass';

/** Where middleware reads the flag from (Edge can't query the database). */
export const MAINTENANCE_STATUS_ENDPOINT = '/api/system/maintenance';

const STATIC_FILE_RE =
  /\.(?:png|jpg|jpeg|webp|gif|svg|ico|avif|mp4|webm|woff2?|ttf|otf|css|js|map|json|txt|xml|wasm)$/i;

/**
 * Requests that must be served even while the site is closed.
 *
 * Three distinct reasons, all of them load-bearing:
 *
 *  1. The holding page's own assets. Blocking `/_next/*` would serve an
 *     unstyled holding page — the gate would break the one page it renders.
 *  2. Liveness. If `/api/system/health` 503s, pm2 and any uptime monitor
 *     conclude the app is dead and start alerting (or restarting) during a
 *     planned window.
 *  3. Money and recovery. Payment webhooks are retried by the provider but
 *     must not be dropped: an order whose capture callback never lands is a
 *     customer charged with nothing to show for it. And the bypass + status
 *     routes have to answer, or there is no way back in.
 */
export function isMaintenanceExemptPath(path: string): boolean {
  if (
    path === UNDER_CONSTRUCTION_PATH ||
    path.startsWith(`${UNDER_CONSTRUCTION_PATH}/`) ||
    path === MAINTENANCE_BYPASS_PATH ||
    path.startsWith(`${MAINTENANCE_BYPASS_PATH}/`) ||
    path === MAINTENANCE_STATUS_ENDPOINT
  ) {
    return true;
  }

  // Liveness + readiness probes.
  if (path === '/api/system/health' || path === '/api/ready') return true;

  // Payment and provider callbacks — never dropped.
  if (path.includes('/webhook')) return true;

  // Asset pipeline, uploaded media, and the rider APK download.
  if (
    path.startsWith('/_next') ||
    path.startsWith('/uploads/') ||
    path.startsWith('/downloads/') ||
    path.startsWith('/download/')
  ) {
    return true;
  }

  // Well-known single files served from /public.
  if (
    path === '/favicon.ico' ||
    path === '/robots.txt' ||
    path === '/sitemap.xml' ||
    path === '/manifest.webmanifest' ||
    path === '/manifest.json' ||
    path === '/sw.js' ||
    path === '/llms.txt'
  ) {
    return true;
  }

  return STATIC_FILE_RE.test(path);
}

/**
 * The two maintenance routes that are valid on BOTH hostnames.
 *
 * The domain split (see `hosts.ts`) otherwise bounces anything that isn't a
 * staff area off portal.flavrly.in — which would send an operator claiming a
 * bypass on the portal over to the customer site, where the cookie it sets is
 * useless (bypass cookies are host-only). Both surfaces need to be able to
 * serve the holding page and accept a claim.
 */
export function isMaintenanceInfraPath(path: string): boolean {
  return (
    path === UNDER_CONSTRUCTION_PATH ||
    path.startsWith(`${UNDER_CONSTRUCTION_PATH}/`) ||
    path === MAINTENANCE_BYPASS_PATH ||
    path.startsWith(`${MAINTENANCE_BYPASS_PATH}/`)
  );
}

/**
 * Whether this request should get a JSON 503 rather than the holding page.
 * API callers (the rider app, server-to-server clients) can't render HTML and
 * shouldn't try to parse it.
 */
export function wantsJsonMaintenanceResponse(path: string): boolean {
  return path.startsWith('/api/');
}
