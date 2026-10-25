/**
 * SUPER_ADMIN account-recovery controls ("nobody gets stuck"), for ANY user:
 * customers, riders, restaurant staff, platform-team roles and other super
 * admins.
 *
 *   adminResetPassword  — set a chosen password, or generate a temporary one that
 *                         is returned ONCE to the super admin; forces a change
 *                         at next login (User.mustChangePassword), signs out.
 *   adminResetTotp      — clear Google Authenticator; re-enrol at next login.
 *   adminUnlock         — clear the password-login lockout + phone-OTP lockouts.
 *   adminSetRole        — change role (signs the user out).
 *   adminSetSuspended   — suspend / reinstate (suspend signs out).
 *   adminSignOut        — sign out everywhere: currentSessionId → null and every
 *                         UserSession revoked. Web JWTs (and rider tokens that
 *                         carry the same sid) stop validating on the next request.
 *   getUserActivity     — recent sessions + audit events by / about the user.
 *
 * Guards: a super admin cannot run these against themselves (self-lockout), and
 * the last active SUPER_ADMIN can never be demoted or suspended. Every action
 * writes an audit row (actor, target, action) — passwords and TOTP secrets are
 * never logged, audited or returned (except the generated temp password, once,
 * in the response to the acting super admin).
 *
 * Callers (route handlers) must already have verified a SUPER_ADMIN session.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { recordLoginSuccess } from './2fa';
import { isStaffTotpRole } from './user-totp';

export const ADMIN_MIN_PASSWORD_LENGTH = 12;

export interface Actor { id: string; role?: string | null }
export interface ReqMeta { ip?: string | null; userAgent?: string | null }
export type AdminResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; message: string };

const fail = (status: number, error: string, message: string) => ({ ok: false as const, status, error, message });

/** Unambiguous alphabet (no 0/O/1/l/I) — easy to read out over the phone. */
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(): string {
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

async function loadTarget(actor: Actor, targetId: string, opts: { allowSelf?: boolean } = {}) {
  if (!opts.allowSelf && actor.id === targetId) {
    return { error: fail(403, 'self_forbidden', 'You cannot do this to your own account here — use your account settings.') };
  }
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.deletedAt) return { error: fail(404, 'not_found', 'User not found.') };
  return { target };
}

/** True when `targetId` is the only active SUPER_ADMIN left. */
async function isLastActiveSuperAdmin(targetId: string): Promise<boolean> {
  const others = await prisma.user.count({
    where: { role: Role.SUPER_ADMIN, suspendedAt: null, deletedAt: null, id: { not: targetId } },
  });
  return others === 0;
}

/** Revoke every session row for the user (the caller nulls currentSessionId). */
async function revokeAllSessions(tx: Pick<typeof prisma, 'userSession'>, userId: string, reason: string) {
  await tx.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

function auditBase(actor: Actor, targetId: string, meta: ReqMeta) {
  return {
    actorId: actor.id,
    actorRole: actor.role ?? null,
    entityType: 'User',
    entityId: targetId,
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  };
}

export async function adminResetPassword(
  actor: Actor,
  targetId: string,
  input: { password?: string },
  meta: ReqMeta = {},
): Promise<AdminResult<{ generated: boolean; tempPassword?: string }>> {
  const { target, error } = await loadTarget(actor, targetId);
  if (error) return error;
  const chosen = input.password;
  if (chosen !== undefined && (chosen.length < ADMIN_MIN_PASSWORD_LENGTH || chosen.length > 200)) {
    return fail(400, 'weak_password', `Password must be ${ADMIN_MIN_PASSWORD_LENGTH}–200 characters.`);
  }
  const password = chosen ?? generateTempPassword();
  const passwordHash = await argon2.hash(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash, mustChangePassword: true, currentSessionId: null },
    });
    await revokeAllSessions(tx, target.id, 'admin_password_reset');
  });
  if (target.email) await recordLoginSuccess(target.email.toLowerCase().trim()); // clear lockout
  await audit('platform.user.password.reset', {
    ...auditBase(actor, target.id, meta),
    after: { generated: chosen === undefined, mustChangePassword: true, sessionsRevoked: true, role: target.role },
  }).catch(() => {});
  return chosen === undefined
    ? { ok: true, generated: true, tempPassword: password }
    : { ok: true, generated: false };
}

export async function adminResetTotp(actor: Actor, targetId: string, meta: ReqMeta = {}): Promise<AdminResult> {
  const { target, error } = await loadTarget(actor, targetId);
  if (error) return error;
  if (!isStaffTotpRole(target.role)) {
    return fail(400, 'no_totp', 'This role signs in with a phone OTP and has no authenticator to reset.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, currentSessionId: null },
    });
    await revokeAllSessions(tx, target.id, 'admin_totp_reset');
  });
  await audit('auth.totp.reset', { ...auditBase(actor, target.id, meta), after: { email: target.email, sessionsRevoked: true } }).catch(() => {});
  return { ok: true };
}

export async function adminUnlock(actor: Actor, targetId: string, meta: ReqMeta = {}): Promise<AdminResult> {
  const { target, error } = await loadTarget(actor, targetId, { allowSelf: true });
  if (error) return error;
  // Password lockout lives in process memory (server/2fa.ts) — this clears it on
  // the instance serving the request; it also auto-expires (lockoutMinutes).
  if (target.email) await recordLoginSuccess(target.email.toLowerCase().trim());
  // Phone-OTP lockouts are DB rows keyed `${phone}:${PURPOSE}`.
  if (target.phone) {
    await prisma.otpAttempt.updateMany({
      where: { id: { startsWith: `${target.phone}:` } },
      data: { attempts: 0, lockedUntil: null },
    });
  }
  await audit('platform.user.unlock', { ...auditBase(actor, target.id, meta), after: { email: !!target.email, phone: !!target.phone } }).catch(() => {});
  return { ok: true };
}

const ALL_ROLES = Object.values(Role) as string[];

export async function adminSetRole(actor: Actor, targetId: string, role: Role, meta: ReqMeta = {}): Promise<AdminResult<{ role: Role }>> {
  if (!ALL_ROLES.includes(role)) return fail(400, 'invalid_role', 'Unknown role.');
  const { target, error } = await loadTarget(actor, targetId);
  if (error) return error;
  if (target.role === role) return { ok: true, role };
  if (target.role === Role.SUPER_ADMIN && (await isLastActiveSuperAdmin(target.id))) {
    return fail(409, 'last_super_admin', 'This is the last active super admin — promote someone else first.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role, currentSessionId: null } });
    await revokeAllSessions(tx, target.id, 'admin_role_change');
  });
  await audit('platform.user.role.change', {
    ...auditBase(actor, target.id, meta),
    before: { role: target.role },
    after: { role },
  }).catch(() => {});
  return { ok: true, role };
}

export async function adminSetSuspended(
  actor: Actor,
  targetId: string,
  suspended: boolean,
  reason: string | undefined,
  meta: ReqMeta = {},
): Promise<AdminResult> {
  const { target, error } = await loadTarget(actor, targetId);
  if (error) return error;
  if (suspended && target.role === Role.SUPER_ADMIN && (await isLastActiveSuperAdmin(target.id))) {
    return fail(409, 'last_super_admin', 'This is the last active super admin and cannot be suspended.');
  }
  const why = (reason ?? '').trim().slice(0, 300) || 'Suspended by platform admin';
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: suspended
        ? { suspendedAt: new Date(), suspendedReason: why, currentSessionId: null }
        : { suspendedAt: null, suspendedReason: null },
    });
    if (suspended) await revokeAllSessions(tx, target.id, 'admin_suspended');
  });
  await audit(suspended ? 'platform.user.suspend' : 'platform.user.reinstate', {
    ...auditBase(actor, target.id, meta),
    before: { suspended: !!target.suspendedAt },
    after: { suspended, reason: suspended ? why : null },
  }).catch(() => {});
  return { ok: true };
}

export async function adminSignOut(actor: Actor, targetId: string, meta: ReqMeta = {}): Promise<AdminResult> {
  const { target, error } = await loadTarget(actor, targetId);
  if (error) return error;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { currentSessionId: null } });
    await revokeAllSessions(tx, target.id, 'admin_signout');
  });
  await audit('platform.user.signout', { ...auditBase(actor, target.id, meta), after: { sessionsRevoked: true } }).catch(() => {});
  return { ok: true };
}

export async function getUserActivity(targetId: string) {
  const [sessions, events] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId: targetId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, lastSeenAt: true, revokedAt: true, revokedReason: true, ipAddress: true, userAgent: true },
    }),
    prisma.auditLog.findMany({
      where: { OR: [{ entityId: targetId }, { actorId: targetId }] },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, action: true, actorId: true, actorRole: true, entityId: true, createdAt: true, ipAddress: true, after: true },
    }),
  ]);
  return { sessions, events };
}
