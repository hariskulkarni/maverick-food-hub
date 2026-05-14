/**
 * Global feature flags. Single source of truth — env-driven for Phase 1,
 * could later read overrides from a `PlatformSetting` row.
 *
 * Phase 1 defaults disable everything that adds cost or complexity:
 *   - Wallet / Loyalty / Referrals (accounting overhead)
 *   - Advanced payouts / Surge (operational complexity)
 *   - WhatsApp (per-message cost in India)
 *   - Customer mobile app (QR + PWA is sufficient)
 *   - S3 (local FS works fine on a single VPS)
 *   - Auto-dispatch (manual rider assignment is safer to launch)
 *   - Advanced analytics (basic dashboards are enough day 1)
 *
 * To turn anything on for staging or beta, set the matching env var to "true"
 * (or "1", "yes", "on"). All other values, including absent, mean off.
 */

function parseBool(v: string | undefined, fallback = false): boolean {
  if (v == null) return fallback;
  return /^(true|1|yes|on)$/i.test(v.trim());
}

export const FLAGS = {
  // Money & rewards
  wallet:           parseBool(process.env.ENABLE_WALLET),
  loyalty:          parseBool(process.env.ENABLE_LOYALTY),
  referrals:        parseBool(process.env.ENABLE_REFERRALS),
  surge:            parseBool(process.env.ENABLE_SURGE_PRICING),
  advancedPayouts:  parseBool(process.env.ENABLE_ADVANCED_PAYOUTS),

  // Channels
  whatsapp:                  parseBool(process.env.ENABLE_WHATSAPP),
  emailCustomerNotifications: parseBool(process.env.ENABLE_EMAIL_CUSTOMER_NOTIFICATIONS),

  // Surfaces
  customerApp:        parseBool(process.env.ENABLE_CUSTOMER_APP),
  advancedAnalytics:  parseBool(process.env.ENABLE_ADVANCED_ANALYTICS),

  // Infrastructure
  s3Storage:          parseBool(process.env.ENABLE_S3_STORAGE),
  autoDispatch:       parseBool(process.env.ENABLE_AUTO_DISPATCH)
} as const;

export type FeatureFlagKey = keyof typeof FLAGS;

/**
 * Check a flag from server code. Throws nothing — just returns false if the
 * flag name is misspelled. Use this everywhere rather than reading the env
 * directly so the source of truth stays in this one file.
 */
export function isEnabled(key: FeatureFlagKey): boolean {
  return FLAGS[key] === true;
}

/** Whole snapshot — useful for /api/me to expose to the client. */
export function flagSnapshot() {
  return { ...FLAGS };
}

/**
 * Phase 1 mode summary string — surfaced on the system health dashboard and
 * super-admin tools so the operator can see what mode the platform is in.
 */
export function deploymentSummary() {
  const enabled = Object.entries(FLAGS).filter(([, v]) => v).map(([k]) => k);
  const phase1 = enabled.length === 0;
  return {
    phase: phase1 ? 'Phase 1 (lean)' : 'Custom',
    enabledFlags: enabled,
    deploymentMode: process.env.DEPLOYMENT_MODE ?? 'LOW_COST_SINGLE_VPS',
    storageProvider: process.env.STORAGE_PROVIDER ?? 'local',
    smsProvider: process.env.SMS_PROVIDER ?? 'msg91',
    emailProvider: process.env.EMAIL_PROVIDER ?? 'zoho_smtp'
  };
}
