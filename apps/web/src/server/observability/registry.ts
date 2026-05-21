/**
 * Logical area registry — groups the ~280 routes/pages into the functional areas
 * an operator reasons about ("Customer site", "Admin", "Payments", ...). The
 * overview API attributes recorded errors to an area by path/source prefix, so
 * the dashboard can show, at a glance, WHERE problems are concentrated.
 */
export interface ObsArea {
  key: string;
  label: string;
  /** A path/source matches this area if it starts with any of these prefixes. */
  prefixes: string[];
}

export const OBS_AREAS: ObsArea[] = [
  { key: 'customer-site', label: 'Customer site (pages)', prefixes: ['/', '/restaurants', '/r/', '/menu', '/cart', '/checkout', '/orders', '/track', '/profile', '/brand', '/combos'] },
  { key: 'customer-api', label: 'Customer APIs', prefixes: ['/api/customer', '/api/checkout', '/api/orders', '/api/addresses', '/api/delivery', '/api/me'] },
  { key: 'auth', label: 'Auth & login', prefixes: ['/login', '/api/auth', '/signup', '/api/signup'] },
  { key: 'admin', label: 'Restaurant admin', prefixes: ['/admin', '/api/admin'] },
  { key: 'kitchen', label: 'Kitchen', prefixes: ['/kitchen', '/api/kitchen'] },
  { key: 'platform', label: 'Platform (super-admin)', prefixes: ['/platform', '/api/platform'] },
  { key: 'rider', label: 'Rider app APIs', prefixes: ['/api/rider', '/rider-app'] },
  { key: 'payments', label: 'Payments & webhooks', prefixes: ['/api/payments'] },
  { key: 'realtime', label: 'Realtime (SSE)', prefixes: ['/api/events'] },
  { key: 'qr', label: 'QR & deep links', prefixes: ['/qr', '/api/qr'] },
  { key: 'tenant', label: 'Restaurant public (/r/[slug] APIs)', prefixes: ['/api/r/'] },
];

/** Match a recorded error's path/source to an area key. Returns 'other' if none. */
export function areaForPath(pathOrSource: string | null | undefined): string {
  if (!pathOrSource) return 'other';
  // The error `source` may be like "route /api/foo" or "render /profile" — pull
  // the first token that looks like a path.
  const token = pathOrSource.split(/\s+/).find((t) => t.startsWith('/')) ?? pathOrSource;
  // Longest-prefix wins so "/api/admin" beats "/" for the same path.
  let best = 'other';
  let bestLen = -1;
  for (const area of OBS_AREAS) {
    for (const p of area.prefixes) {
      if (p === '/' ? token === '/' : token.startsWith(p)) {
        if (p.length > bestLen) { bestLen = p.length; best = area.key; }
      }
    }
  }
  return best;
}
