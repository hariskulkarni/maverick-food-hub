/**
 * Host / domain-split configuration (edge-safe — no node APIs).
 *
 * Flavrly runs as ONE Next.js deployment served on two hostnames:
 *   - PUBLIC_HOST  (flavrly.in)        → customers only (storefront, ordering)
 *   - PORTAL_HOST  (portal.flavrly.in) → ADMIN + SUPER_ADMIN + KITCHEN
 *
 * The Host header decides behaviour; middleware enforces the split. Sessions
 * are host-only cookies, so the two surfaces are naturally isolated.
 *
 * Both hosts are env-overridable but default to the production domains. On
 * localhost / the raw VPS IP the split is inactive, so dev + direct-origin
 * access behave as a single combined host (all routes + all login roles).
 */
export const PUBLIC_HOST = (process.env.PUBLIC_HOST || 'flavrly.in').toLowerCase();
export const PORTAL_HOST = (process.env.PORTAL_HOST || 'portal.flavrly.in').toLowerCase();

/** Strip port + lowercase. */
export function normalizeHost(h: string | null | undefined): string {
  return (h || '').toLowerCase().split(':')[0];
}

/** True for the staff portal host. */
export function isPortalHost(h: string | null | undefined): boolean {
  const host = normalizeHost(h);
  return host === PORTAL_HOST || host.startsWith('portal.');
}

/**
 * Should the host split apply at all? Only for the real domain(s). localhost,
 * 127.0.0.1, and the bare VPS IP fall through as a single combined host so dev
 * and direct-origin health checks keep working unchanged.
 */
export function hostSplitActive(h: string | null | undefined): boolean {
  const host = normalizeHost(h);
  if (!host) return false;
  return host === PUBLIC_HOST || host === PORTAL_HOST || host.endsWith('.flavrly.in') || host === 'flavrly.in';
}

/** Route prefixes that belong ONLY to the staff portal. */
export const STAFF_PREFIXES = ['/platform', '/admin', '/kitchen'];

export function isStaffPath(path: string): boolean {
  return STAFF_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}
