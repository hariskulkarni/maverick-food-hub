import { Role } from '@prisma/client';

/**
 * C11: phone-OTP (and the MSG91 widget) is a customer/rider login factor only.
 * Staff roles (ADMIN, SUPER_ADMIN, KITCHEN) must authenticate via password +
 * TOTP and the IP allowlist — an OTP alone must never grant a staff session.
 *
 * Kept in its own dependency-free module so the policy is unit-testable without
 * importing the full NextAuth provider tree.
 */
export function phoneOtpRoleAllowed(role: Role): boolean {
  return role === Role.CUSTOMER || role === Role.RIDER;
}
