/**
 * Email password reset (all roles).
 *
 * Security properties:
 *  - No user enumeration: requestPasswordReset() returns silently for unknown /
 *    credential-less accounts; the API always answers 200.
 *  - Token: 32 random bytes (base64url). Only its sha256 is stored; the raw
 *    value exists solely in the emailed link. Single-use (atomic claim on
 *    usedAt IS NULL) and expires after 30 minutes.
 *  - On reset: password replaced, ALL sessions revoked, and for staff roles the
 *    TOTP secret is cleared (forces fresh enrolment; breaks the circular
 *    super-admin lockout).
 *  - The raw token is never logged, audited or journaled.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../db';
import { audit } from '../audit';
import { log } from '../log';
import { notify } from '../notifications';
import { recordLoginSuccess } from '../2fa';
import { isStaffTotpRole } from '../user-totp';
import { brand } from '@/lib/brand';

export const RESET_TTL_MS = 30 * 60_000;
export const MIN_PASSWORD_LENGTH = 10;

export function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function requestPasswordReset(email: string, ip?: string): Promise<void> {
  const normalized = String(email ?? '').toLowerCase().trim();
  if (!normalized) return;

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !user.passwordHash || !user.email) return; // silent: no enumeration

  const now = new Date();
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256hex(raw),
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      requestedIp: ip ?? null,
    },
  });

  const link = `${brand.url}/reset-password?token=${raw}`;
  const text =
    `We received a request to reset your ${brand.name} password.\n\n` +
    `Reset it here (link valid for 30 minutes, single use):\n${link}\n\n` +
    `If you did not request this, you can ignore this email.`;
  const html =
    `<p>We received a request to reset your ${brand.name} password.</p>` +
    `<p><a href="${link}">Reset your password</a></p>` +
    `<p>This link is valid for 30 minutes and can be used once. ` +
    `If you did not request this, you can ignore this email.</p>`;
  try {
    const res: any = await notify.email({
      to: user.email,
      subject: 'Reset your Flavrly password',
      body: text,
      html,
      template: 'password-reset',
      userId: user.id,
    } as any);
    if (res && res.ok === false) {
      log.warn({ userId: user.id }, 'password reset email not delivered (email provider unconfigured or failed)');
    }
  } catch (e) {
    log.warn({ userId: user.id, err: (e as Error).message }, 'password reset email send threw');
  }
}

class TokenClaimLost extends Error {}

export type ConsumeResult =
  | { ok: true; staffReenroll: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'weak' };

export async function consumePasswordReset(rawToken: string, newPassword: string): Promise<ConsumeResult> {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'weak' };
  }
  const tokenHash = sha256hex(String(rawToken ?? ''));
  const now = new Date();

  const row = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    include: { user: true },
  });
  if (!row) {
    const expired = await prisma.passwordResetToken.findFirst({ where: { tokenHash, usedAt: null } });
    return { ok: false, reason: expired ? 'expired' : 'invalid' };
  }

  const staff = isStaffTotpRole(row.user.role);
  const passwordHash = await argon2.hash(newPassword);

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic single-use claim: only one concurrent consumer can win.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claim.count !== 1) throw new TokenClaimLost();

      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          currentSessionId: null,
          ...(staff ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null } : {}),
        },
      });
      await tx.userSession.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_reset' },
      });
    });
  } catch (e) {
    if (e instanceof TokenClaimLost) return { ok: false, reason: 'invalid' };
    throw e;
  }

  if (row.user.email) recordLoginSuccess(row.user.email.toLowerCase().trim()); // clear failure lockout
  await audit('auth.password.reset', {
    actorId: row.userId,
    actorRole: row.user.role,
    entityType: 'User',
    entityId: row.userId,
    after: { sessionsRevoked: true, totpCleared: staff },
  }).catch(() => {});
  if (staff) {
    await audit('auth.totp.cleared_by_reset', {
      actorId: row.userId,
      actorRole: row.user.role,
      entityType: 'User',
      entityId: row.userId,
      after: { reason: 'password_reset' },
    }).catch(() => {});
  }
  return { ok: true, staffReenroll: staff };
}
