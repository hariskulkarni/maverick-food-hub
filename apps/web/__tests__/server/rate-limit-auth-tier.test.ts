/**
 * Lead item 6: the strict per-IP auth tier (20/min + exponential backoff) is
 * for credential-guessing endpoints. Session-gated platform actions whose URL
 * merely contains "password"/"verify" (super-admin user recovery) use the
 * normal per-IP + per-user limits instead.
 */
import { describe, it, expect } from 'vitest';
import { isAuthRateLimitPath } from '@/server/http/rate-limit-paths';

describe('isAuthRateLimitPath', () => {
  it('credential endpoints are in the strict tier', () => {
    for (const p of ['/api/auth/staff/precheck', '/api/auth/otp', '/api/auth/password/reset', '/api/rider/auth/verify-otp', '/api/account/change-password']) {
      expect(isAuthRateLimitPath(p)).toBe(true);
    }
  });
  it('super-admin platform actions are not', () => {
    for (const p of ['/api/platform/users/u1/reset-password', '/api/platform/users/u1/admin', '/api/platform/security/totp/verify', '/api/platform/users/u1/reset-totp']) {
      expect(isAuthRateLimitPath(p)).toBe(false);
    }
  });
});
