/**
 * C11 — phone-OTP (and the MSG91 widget) must only grant sessions to CUSTOMER
 * and RIDER. Staff roles authenticate via password + TOTP, never an OTP alone.
 * (auth.ts applies phoneOtpRoleAllowed() in both OTP providers' authorize().)
 */
import { describe, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { phoneOtpRoleAllowed } from '@/server/phone-otp-policy';

describe('C11: phoneOtpRoleAllowed', () => {
  it('allows CUSTOMER and RIDER', () => {
    expect(phoneOtpRoleAllowed(Role.CUSTOMER)).toBe(true);
    expect(phoneOtpRoleAllowed(Role.RIDER)).toBe(true);
  });
  it('blocks ADMIN, SUPER_ADMIN and KITCHEN', () => {
    expect(phoneOtpRoleAllowed(Role.ADMIN)).toBe(false);
    expect(phoneOtpRoleAllowed(Role.SUPER_ADMIN)).toBe(false);
    expect(phoneOtpRoleAllowed(Role.KITCHEN)).toBe(false);
  });
});
