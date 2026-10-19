/**
 * C10 — resolve the real client IP from request headers.
 *
 * The left-most X-Forwarded-For hop is CLIENT-SUPPLIED and must never be
 * trusted: rotating it defeated every rate limit, the brute-force backoff, the
 * per-phone/per-IP OTP caps, and the SUPER_ADMIN login IP allowlist.
 *
 * Production ingress is Cloudflare -> nginx:
 *   - nginx sets `CF-Connecting-IP` via `real_ip_header`, trusting only the
 *     Cloudflare `set_real_ip_from` ranges, so it cannot be forged by a client;
 *   - nginx appends the real peer to X-Forwarded-For with
 *     `$proxy_add_x_forwarded_for`, so the trustworthy hop is the LAST element.
 *
 * Resolution order: CF-Connecting-IP, then X-Real-IP, then the LAST XFF element.
 * Never the first. Returns null when nothing resolves (callers coarsen to a
 * global bucket rather than failing open on an attacker-chosen key).
 *
 * Dependency-free on purpose: safe to import from the edge middleware runtime.
 */
export function clientIp(headers: { get(name: string): string | null } | Headers): string | null {
  const cf = headers.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();

  const real = headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return null;
}
