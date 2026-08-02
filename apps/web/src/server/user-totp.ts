/**
 * Per-user Google Authenticator (TOTP) 2FA for staff roles
 * (ADMIN / SUPER_ADMIN / KITCHEN). Customers and riders never use this — they
 * authenticate via phone OTP.
 *
 * Model (fields on User):
 *   totpSecret        — active, verified secret (AES-256-GCM encrypted)
 *   totpPendingSecret — secret awaiting first confirmation (encrypted)
 *   totpEnabledAt     — set once enrollment is confirmed; null ⇒ not enrolled
 *
 * Flow: startEnrollment() mints a pending secret + QR → the user scans it in
 * Google Authenticator → confirmEnrollment() verifies the first code and
 * promotes pending → active. Login then requires a valid code every time.
 * A super-admin can resetUserTotp() to force re-enrollment.
 */
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from './db';
import { encryptJSON, decryptJSON } from './crypto';
import { Role } from '@prisma/client';

const ISSUER = 'Flavrly';

/** Roles that must use a Google Authenticator code as a second factor. */
export const STAFF_TOTP_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.KITCHEN];
export function isStaffTotpRole(role: Role | string | null | undefined): boolean {
  return !!role && (STAFF_TOTP_ROLES as string[]).includes(String(role));
}

const enc = (secret: string): string => encryptJSON({ s: secret });
const dec = (blob: string | null | undefined): string | null => {
  if (!blob) return null;
  try { return decryptJSON<{ s: string }>(blob).s ?? null; } catch { return null; }
};

/** Constant-ish verify of a raw base32 secret against a submitted code. */
export function verifyTotpSecret(secret: string | null, token: string | null | undefined): boolean {
  if (!secret || !token) return false;
  try { return authenticator.verify({ token: String(token).replace(/\s+/g, ''), secret }); }
  catch { return false; }
}

/** Verify a login code against a user's ACTIVE secret. */
export function verifyUserTotp(user: { totpSecret: string | null }, token: string | null | undefined): boolean {
  return verifyTotpSecret(dec(user.totpSecret), token);
}

export function isTotpEnrolled(user: { totpEnabledAt: Date | null }): boolean {
  return !!user.totpEnabledAt;
}

/** Mint a pending secret + QR (data URL) for enrollment. Overwrites any prior pending. */
export async function startEnrollment(
  userId: string,
  accountLabel: string
): Promise<{ otpauth: string; qr: string; secret: string }> {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(accountLabel || userId, ISSUER, secret);
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: enc(secret) } });
  return { otpauth, qr, secret };
}

/** Verify the first code against the pending secret; promote pending → active. */
export async function confirmEnrollment(userId: string, code: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { totpPendingSecret: true } });
  const pending = dec(u?.totpPendingSecret ?? null);
  if (!pending || !verifyTotpSecret(pending, code)) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: enc(pending), totpPendingSecret: null, totpEnabledAt: new Date() },
  });
  return true;
}

/** Super-admin reset — clears TOTP so the user must re-enroll on next login. */
export async function resetUserTotp(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null },
  });
}
