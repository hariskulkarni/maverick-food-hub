/**
 * Per-user Google Authenticator (TOTP) 2FA for staff + platform-team roles
 * (ADMIN / SUPER_ADMIN / KITCHEN / ADMIN_ASSIST / DEVELOPER / QA / GUEST). Customers and riders never use this — they
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

// Tolerate +/-1 30s step of clock drift between the authenticator device and
// this server. Never widen beyond 1 — each extra step enlarges the brute-force
// surface. (otplib's `authenticator` is a shared singleton, so this also governs
// server/2fa.ts; it is set explicitly there too.)
authenticator.options = { ...authenticator.options, window: 1 };

/**
 * Roles that must use a Google Authenticator code as a second factor: every
 * role that signs in with email + password (restaurant staff and the platform
 * team). Customers and riders use phone OTP instead.
 */
export const STAFF_TOTP_ROLES: Role[] = [
  Role.ADMIN, Role.SUPER_ADMIN, Role.KITCHEN,
  Role.ADMIN_ASSIST, Role.DEVELOPER, Role.QA, Role.GUEST,
];
export function isStaffTotpRole(role: Role | string | null | undefined): boolean {
  return !!role && (STAFF_TOTP_ROLES as string[]).includes(String(role));
}

/**
 * Break-glass accounts (env `BREAKGLASS_EMAILS`, comma-separated) are exempt
 * from the Google Authenticator + IP-allowlist gates so they can always sign in
 * with email + password in an emergency. Use sparingly — this is single-factor
 * top-level access. Every break-glass login is audited.
 */
export function isBreakGlassEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.BREAKGLASS_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return list.includes(email.toLowerCase().trim());
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

/** Absolute 30s step the token matches for `secret` (±window), or null. */
export function matchTotpStep(secret: string | null, token: string | null | undefined): number | null {
  if (!secret || !token) return null;
  try {
    const delta = authenticator.checkDelta(String(token).replace(/\s+/g, ''), secret);
    if (delta === null || delta === undefined) return null;
    return Math.floor(Date.now() / 1000 / 30) + delta; // otplib default step = 30s
  } catch {
    return null;
  }
}

/**
 * F15: verify a LOGIN code against the user's active secret AND consume it.
 * The matched step must be strictly newer than the last accepted one; the
 * conditional updateMany makes the claim atomic, so a replayed (or concurrent
 * duplicate) code is refused even inside the ±1 step skew window.
 */
export async function consumeUserTotp(
  user: { id: string; totpSecret: string | null },
  token: string | null | undefined
): Promise<boolean> {
  const step = matchTotpStep(dec(user.totpSecret), token);
  if (step === null) return false;
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
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
    data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
}
