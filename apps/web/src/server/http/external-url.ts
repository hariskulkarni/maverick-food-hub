/**
 * Resolve the EXTERNAL (public, browser-facing) base URL for the current
 * request.
 *
 * Why this exists: in a Next.js Route Handler, `request.url` / `request.nextUrl`
 * are built from the server's internal binding (e.g. `http://localhost:3000`),
 * NOT from the host the browser actually used. Behind the nginx reverse proxy
 * (`proxy_set_header Host $host; X-Forwarded-Proto $scheme;`) the real public
 * host arrives in the `Host` (and sometimes `X-Forwarded-Host`) header. Building
 * an absolute redirect with `new URL(path, request.url)` therefore sends the
 * browser to `localhost:3000` — which it cannot reach. Use this helper for any
 * server-issued redirect whose Location must be a public URL (OAuth callbacks,
 * etc.).
 *
 * Precedence: X-Forwarded-Host → Host header → `GOOGLE_OAUTH_REDIRECT_URI`
 * origin → `NEXT_PUBLIC_SITE_URL` / brand default. The proto comes from
 * X-Forwarded-Proto (default https). A localhost/127.0.0.1 host is rejected in
 * favour of the configured public fallback so a mis-forwarded request can never
 * redirect to loopback.
 */
import { brand } from '@/lib/brand';

function isLoopback(host: string): boolean {
  const h = host.toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

export function externalBaseUrl(headers: Headers): string {
  const proto = (headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim() || 'https';
  const fwdHost = (headers.get('x-forwarded-host') ?? '').split(',')[0].trim();
  const host = fwdHost || (headers.get('host') ?? '').trim();

  if (host && !isLoopback(host)) {
    return `${proto}://${host}`;
  }

  // Fallbacks when the header is missing or points at loopback.
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (redirectUri) {
    try {
      const o = new URL(redirectUri).origin;
      if (!isLoopback(new URL(redirectUri).host)) return o;
    } catch {
      /* ignore malformed env */
    }
  }
  return brand.url;
}
