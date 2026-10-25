/**
 * Which /api paths get the middleware's STRICT auth tier (20/min per IP plus
 * exponential backoff). Only credential-guessing surfaces belong here.
 * /api/platform/* is session-gated (SUPER_ADMIN + TOTP), so super-admin
 * account-recovery actions whose URLs contain "password"/"verify"/"totp" use the
 * normal per-IP + per-user limits instead of tripping the brute-force backoff.
 * Dependency-free: imported by the edge middleware.
 */
export function isAuthRateLimitPath(p: string): boolean {
  if (p.startsWith('/api/platform/')) return false;
  return p.includes('/auth/') || /(login|signin|otp|verify|password|2fa)/i.test(p);
}
