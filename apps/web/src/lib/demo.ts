/**
 * Demo-mode helpers.
 *
 * The ONE source of truth: `process.env.DEMO_MODE === 'true'`. When that flag
 * is on, the runtime behaves as a sandbox:
 *   • A yellow "DEMO" banner appears on every page.
 *   • A shared-password gate (DEMO_GATE_PASSWORD) guards every URL.
 *   • OTPs always accept the demo code (OTP_DEMO_MODE=true should be set too).
 *   • SMS / WhatsApp / push are no-ops (NOTIFIER_SMS=mock recommended).
 *   • Razorpay is replaced by the mock provider (PAYMENT_PROVIDER=mock).
 *   • A "Reset demo" button appears in /platform that wipes + reseeds the DB.
 *
 * IMPORTANT: prod's behaviour is UNCHANGED. None of this affects `flavrly.in`
 * unless `DEMO_MODE=true` is set in that runtime's env (it never is on prod).
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/** Public site URL for THIS runtime (prod or demo). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/$/, '');
}

/**
 * Pre-baked demo accounts seeded by `prisma/seed-demo.ts`. We surface them on
 * the gate page so the client can hand them out on a call without looking
 * them up.
 */
export const DEMO_LOGINS = {
  superAdmin: { email: 'superadmin@demo.flavrly.in', password: 'Demo123!' },
  admin:      { email: 'admin@demo.flavrly.in',      password: 'Demo123!' },
  kitchen:    { email: 'kitchen@demo.flavrly.in',    password: 'Demo123!' },
  riderPhone: '+91 90000 00001',
  customerPhone: '+91 99999 99999',
  otpCode: '123456',
};

/** Demo-mode JWT secret. Falls back to NEXTAUTH_SECRET so we always have one. */
export function demoSecret(): string {
  return process.env.DEMO_GATE_SECRET || process.env.NEXTAUTH_SECRET || 'demo-fallback-secret-not-for-prod';
}

/** TTL for the gate cookie / signed token. */
export const DEMO_GATE_TTL_SECONDS = 60 * 60 * 24; // 24h
export const DEMO_COOKIE_NAME = 'flavrly_demo_gate';
