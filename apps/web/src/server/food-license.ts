/**
 * Food-license (FSSAI) expiry helpers — shared by the admin banner, the daily
 * alert sweep, the branch form badge, and the public storefront footer.
 *
 * A licence is "expiring soon" when its expiry is within EXPIRY_WARN_DAYS. The
 * FSSAI Form-C itself instructs licensees to apply for renewal at least 30 days
 * before expiry, so 30 is the default warning window.
 *
 * Pure functions only (no DB / no React) so they can be reused on the server,
 * in the client form, and unit-tested without a database.
 */

/** Days before expiry at which we start warning (FSSAI renewal lead time). */
export const EXPIRY_WARN_DAYS = 30;

export type LicenseState = 'none' | 'valid' | 'expiring' | 'expired';

export interface LicenseStatus {
  state: LicenseState;
  /** Whole days until expiry. Negative ⇒ already expired. null ⇒ no expiry set. */
  daysLeft: number | null;
  /** Convenience flag for callers that only care about "needs attention". */
  needsAttention: boolean;
}

/**
 * Resolve a licence's status from its expiry date.
 *
 * @param expiresOn  the licence expiry (Date | ISO string | null)
 * @param hasNumber  whether a licence number has been captured at all. A branch
 *                   with neither a number nor a date is `'none'` (nothing to
 *                   warn about); a number with no date is `'valid'` (we can't
 *                   compute expiry, so we don't nag).
 * @param now        injectable clock for tests
 */
export function licenseStatus(
  expiresOn: Date | string | null | undefined,
  hasNumber: boolean,
  now: Date = new Date()
): LicenseStatus {
  if (!expiresOn) {
    return { state: hasNumber ? 'valid' : 'none', daysLeft: null, needsAttention: false };
  }
  const exp = typeof expiresOn === 'string' ? new Date(expiresOn) : expiresOn;
  if (Number.isNaN(exp.getTime())) {
    return { state: hasNumber ? 'valid' : 'none', daysLeft: null, needsAttention: false };
  }

  // Compare at day granularity (midnight-to-midnight) so "expires today" reads
  // as 0 days left rather than a fractional value.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfExpiry = new Date(exp);
  startOfExpiry.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((startOfExpiry.getTime() - startOfToday.getTime()) / 86_400_000);

  if (daysLeft < 0) return { state: 'expired', daysLeft, needsAttention: true };
  if (daysLeft <= EXPIRY_WARN_DAYS) return { state: 'expiring', daysLeft, needsAttention: true };
  return { state: 'valid', daysLeft, needsAttention: false };
}

/** Short human label e.g. "Expires in 12 days" / "Expired 3 days ago". */
export function licenseStatusLabel(s: LicenseStatus): string {
  switch (s.state) {
    case 'none':
      return 'No licence on file';
    case 'expired': {
      const d = Math.abs(s.daysLeft ?? 0);
      return d === 0 ? 'Expired today' : `Expired ${d} day${d === 1 ? '' : 's'} ago`;
    }
    case 'expiring': {
      const d = s.daysLeft ?? 0;
      return d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}`;
    }
    case 'valid':
    default:
      return s.daysLeft == null ? 'On file' : `Valid · ${s.daysLeft} days left`;
  }
}
