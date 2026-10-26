import { NextResponse, type NextRequest } from 'next/server';

/**
 * CSRF defense-in-depth for the cookie-authenticated (browser) surface.
 * Rejects state-changing requests that a browser marks as cross-site, or whose
 * Origin doesn't match the host:
 *   • Bearer-token requests (native rider app) are skipped — not cookie-CSRF-able.
 *   • NextAuth (/api/auth) has its own CSRF token; the exact provider webhook
 *     paths below are signature-verified and skipped.
 *   • `Sec-Fetch-Site: cross-site` → blocked, even with no or an unparseable
 *     Origin (e.g. `Origin: null` from a sandboxed frame). Browsers set this
 *     header themselves; page script cannot forge it (T-16).
 *   • No Origin and no cross-site marker (native/server clients) → allowed.
 *   • Unparseable Origin without a cross-site marker → allowed (SameSite=Lax
 *     cookies still protect).
 */
// Exact provider webhook endpoints (signature-verified). A substring match on
// '/webhook' let any future route containing it skip CSRF and rate limiting.
const WEBHOOK_PATHS = new Set([
  '/api/payments/webhook',
  '/api/payments/razorpay/webhook',
  '/api/payments/phonepe/webhook',
  '/api/payments/youpi/webhook',
]);
// Novaryq POS posts per restaurant (signature-verified with that restaurant's secret).
const NOVARYQ_WEBHOOK = /^\/api\/integrations\/novaryq\/webhook\/[A-Za-z0-9_-]{1,64}$/;
export function isWebhookPath(path: string): boolean {
  const p = path.replace(/\/+$/, '');
  return WEBHOOK_PATHS.has(p) || NOVARYQ_WEBHOOK.test(p);
}

function blocked(): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Cross-origin request blocked.' }),
    { status: 403, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function csrfGuard(req: NextRequest, path: string): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const authz = req.headers.get('authorization');
  if (authz && authz.startsWith('Bearer ')) return null;
  if (path.startsWith('/api/auth') || isWebhookPath(path)) return null;
  if (req.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') return blocked();
  const origin = req.headers.get('origin');
  if (!origin) return null;
  try {
    if (new URL(origin).host !== req.headers.get('host')) return blocked();
  } catch {
    return null;
  }
  return null;
}
