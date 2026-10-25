/**
 * Deployment summary for the platform system-health dashboard.
 *
 * Reports the settings delivery code ACTUALLY reads, so the operator sees the
 * truth (the old ENABLE_* "Phase 1" flags were never read anywhere and were
 * removed; SMS used to show SMS_PROVIDER ?? 'msg91' while delivery reads
 * NOTIFIER_SMS):
 *   - SMS:      NOTIFIER_SMS (legacy alias SMS_PROVIDER)   — server/notifications.ts, server/otp.ts
 *   - Email:    NOTIFIER_EMAIL (alias EMAIL_PROVIDER); plain SMTP when only SMTP_HOST is set
 *   - WhatsApp: NOTIFIER_WHATSAPP
 *   - Storage:  STORAGE_DRIVER ('s3' | local)             — server/storage.ts
 * Per-restaurant integration credentials override these env defaults.
 */

const NOT_CONFIGURED = 'mock (not configured)';

function env(...names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] ?? '').toLowerCase().trim();
    if (v) return v;
  }
  return '';
}

export function deploymentSummary() {
  const email = env('NOTIFIER_EMAIL', 'EMAIL_PROVIDER') || ((process.env.SMTP_HOST ?? '').trim() ? 'smtp' : '');
  return {
    deploymentMode: process.env.DEPLOYMENT_MODE ?? 'LOW_COST_SINGLE_VPS',
    storageProvider: env('STORAGE_DRIVER') === 's3' ? 's3' : 'local',
    smsProvider: env('NOTIFIER_SMS', 'SMS_PROVIDER') || NOT_CONFIGURED,
    emailProvider: email || NOT_CONFIGURED,
    whatsappProvider: env('NOTIFIER_WHATSAPP') || NOT_CONFIGURED,
  };
}
