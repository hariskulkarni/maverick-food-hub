/**
 * Auth: NextAuth v5 with two flows.
 *  - phone-otp: customers and riders. OTP printed to dev console (mock), sent via SMS in prod.
 *  - email-password: admin and kitchen users. Argon2id-hashed passwords.
 *
 * Role enforcement happens here (in `authorize`) and again in middleware + route helpers.
 */

import NextAuth, { type NextAuthConfig, type Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import argon2 from 'argon2';
import { prisma } from './db';
import { Role } from '@prisma/client';
import { sendOtp, verifyOtp } from './otp';
import { authEdgeConfig } from './auth.config';
import {
  getPlatformSecurity,
  ipMatchesAllowlist,
  isLockedOut,
  recordLoginFailure,
  recordLoginSuccess
} from './2fa';
import { audit } from './audit';
import { headers } from 'next/headers';
import { startSession, isSessionActive, revokeSession } from './sessions';
import { isStaffTotpRole, verifyUserTotp, isBreakGlassEmail } from './user-totp';
import { verifyWidgetAccessToken } from './msg91-widget';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      branchId?: string | null;
    };
  }
}

/**
 * Whether an unknown phone/email may self-register a CUSTOMER account on first
 * login. Default ON (a storefront needs open signup). Set
 * ALLOW_CUSTOMER_SELF_SIGNUP=false to lock the platform down so ONLY
 * pre-registered/invited accounts can log in anywhere. Staff (email-password)
 * and riders (rider auth) already require pre-existing accounts regardless.
 */
function allowCustomerSelfSignup(): boolean {
  return process.env.ALLOW_CUSTOMER_SELF_SIGNUP !== 'false';
}

export const authConfig: NextAuthConfig = {
  ...authEdgeConfig,
  providers: [
    Credentials({
      id: 'phone-otp',
      name: 'Phone OTP',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        code: { label: 'Code', type: 'text' },
        purpose: { label: 'Purpose', type: 'text' }
      },
      async authorize(creds) {
        const phone = String(creds?.phone ?? '').trim();
        const code = String(creds?.code ?? '').trim();
        const purpose = String(creds?.purpose ?? 'login').trim();
        if (!phone || !code) return null;
        const ok = await verifyOtp({ phone, code, purpose });
        if (!ok) return null;
        // We need to know whether this is a *new* customer to decide whether
        // to issue a signup bonus, so check before upserting.
        const existing = await prisma.user.findUnique({ where: { phone } });
        // Suspended accounts cannot log in (a super-admin has blocked them).
        if (existing?.suspendedAt) {
          await audit('auth.login.failed', { actorId: existing.id, entityType: 'User', entityId: existing.id, after: { reason: 'suspended', provider: 'phone-otp' } }).catch(() => {});
          return null;
        }
        if (!existing && !allowCustomerSelfSignup()) {
          // Locked-down mode: an unregistered phone cannot create an account by
          // logging in. (Even though the OTP was valid.) They must be onboarded
          // first. Audit so admins can see attempts.
          await audit('auth.login.unregistered', { entityType: 'User', after: { phone, provider: 'phone-otp' } }).catch(() => {});
          return null;
        }
        const user = existing ?? await prisma.user.create({ data: { phone, role: Role.CUSTOMER } });
        if (!existing) {
          // First-time OTP verification = signup. Phone is known here (and is
          // the canonical anti-abuse key), so phone-based dedup works. IP isn't
          // surfaced through next-auth's authorize() — admins can opt-out of
          // IP checks via the SignupBonusConfig if they want a stricter mode.
          try {
            const { grantSignupBonus } = await import('./signup-bonus');
            await grantSignupBonus(user.id, { phone });
          } catch {}
        }
        return { id: user.id, name: user.name ?? null, email: user.email ?? null };
      }
    }),
    // MSG91 OTP Widget — multi-channel (SMS/WhatsApp/Voice/Email) customer OTP.
    // The browser widget verifies the code and returns a signed access-token;
    // we confirm it with MSG91 and derive the phone from the token itself.
    // Enabled only when the widget env is configured (else the built-in phone
    // OTP flow above is used). Same customer provisioning + signup bonus.
    Credentials({
      id: 'msg91-widget',
      name: 'MSG91 Widget OTP',
      credentials: {
        accessToken: { label: 'Access Token', type: 'text' },
        phone: { label: 'Phone', type: 'tel' }
      },
      async authorize(creds) {
        const token = String(creds?.accessToken ?? '').trim();
        const claimed = String(creds?.phone ?? '').trim();
        if (!token) return null;
        const { ok, phone } = await verifyWidgetAccessToken(token, claimed);
        if (!ok || !phone) return null;
        const existing = await prisma.user.findUnique({ where: { phone } });
        if (existing?.suspendedAt) {
          await audit('auth.login.failed', { actorId: existing.id, entityType: 'User', entityId: existing.id, after: { reason: 'suspended', provider: 'msg91-widget' } }).catch(() => {});
          return null;
        }
        if (!existing && !allowCustomerSelfSignup()) {
          await audit('auth.login.unregistered', { entityType: 'User', after: { phone, provider: 'msg91-widget' } }).catch(() => {});
          return null;
        }
        const user = existing ?? await prisma.user.create({ data: { phone, role: Role.CUSTOMER } });
        if (!existing) {
          try {
            const { grantSignupBonus } = await import('./signup-bonus');
            await grantSignupBonus(user.id, { phone });
          } catch { /* bonus best-effort */ }
        }
        return { id: user.id, name: user.name ?? null, email: user.email ?? null };
      }
    }),
    Credentials({
      id: 'email-password',
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' }
      },
      async authorize(creds, req) {
        const email = String(creds?.email ?? '').toLowerCase().trim();
        const password = String(creds?.password ?? '');
        const totp = String(creds?.totp ?? '').trim();
        if (!email || !password) return null;

        // Look up policy + lockout state up front. We read it before validating
        // the password so a brute-forcer can't bypass lockout by spamming.
        const sec = await getPlatformSecurity().catch(() => ({} as Awaited<ReturnType<typeof getPlatformSecurity>>));
        const lockoutMinutes = sec.lockoutMinutes ?? 15;
        if (isLockedOut(email)) {
          await audit('auth.login.locked', { entityType: 'User', after: { email } }).catch(() => {});
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
          recordLoginFailure(email, lockoutMinutes);
          return null;
        }
        // Password login is for STAFF + PLATFORM-team roles only. Customers and
        // riders authenticate via OTP (and the rider native app), never here.
        if (user.role === Role.CUSTOMER || user.role === Role.RIDER) return null;
        // Suspended accounts cannot log in (a super-admin has blocked them).
        if (user.suspendedAt) {
          recordLoginFailure(email, lockoutMinutes);
          await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'suspended' } }).catch(() => {});
          return null;
        }

        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) {
          recordLoginFailure(email, lockoutMinutes);
          await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'bad_password' } }).catch(() => {});
          return null;
        }

        // Super-admin keeps the IP allowlist gate.
        // Break-glass accounts (env BREAKGLASS_EMAILS) skip the IP allowlist and
        // 2FA gates so they can always sign in with email + password in an
        // emergency. Single-factor top-level access — every such login is audited.
        const isBreak = isBreakGlassEmail(user.email);

        if (!isBreak && user.role === Role.SUPER_ADMIN && sec.allowlist && sec.allowlist.length > 0) {
          const fwd = req?.headers?.get?.('x-forwarded-for') ?? '';
          const ip = String(fwd || '').split(',')[0]!.trim();
          if (!ip || !ipMatchesAllowlist(ip, sec.allowlist)) {
            recordLoginFailure(email, lockoutMinutes);
            await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'ip_not_allowlisted', ip } }).catch(() => {});
            return null;
          }
        }

        // Per-user Google Authenticator (2FA) for every staff role
        // (ADMIN / SUPER_ADMIN / KITCHEN). Must be enrolled AND present a valid
        // 6-digit code on every login. Enrollment: /api/auth/staff/precheck+enroll.
        // Break-glass accounts are exempt.
        if (!isBreak && isStaffTotpRole(user.role)) {
          if (!user.totpEnabledAt) {
            recordLoginFailure(email, lockoutMinutes);
            await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'totp_not_enrolled' } }).catch(() => {});
            return null;
          }
          if (!totp || !verifyUserTotp(user, totp)) {
            recordLoginFailure(email, lockoutMinutes);
            await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'totp_invalid' } }).catch(() => {});
            return null;
          }
        }

        if (isBreak) {
          await audit('auth.login.breakglass', { actorId: user.id, actorRole: user.role, entityType: 'User', entityId: user.id, after: { email: user.email } }).catch(() => {});
        }

        recordLoginSuccess(email);
        return { id: user.id, name: user.name ?? null, email: user.email ?? null };
      }
    }),
    // Google OAuth — customer sign-in on tenant login pages. Conditional on env so
    // local/dev builds without Google credentials still boot.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : [])
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google flow: provision/lookup a User by email. New emails become CUSTOMER;
      // existing accounts keep whatever role they already have (so a kitchen user
      // who happens to use Google still gets KITCHEN, not CUSTOMER).
      if (account?.provider === 'google') {
        const email = (user.email ?? '').toLowerCase().trim();
        if (!email) return false;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          (user as any).id = existing.id;
          return true;
        }
        if (!allowCustomerSelfSignup()) {
          // Locked-down mode: unknown Google account cannot self-register.
          await audit('auth.login.unregistered', { entityType: 'User', after: { email, provider: 'google' } }).catch(() => {});
          return false;
        }
        const created = await prisma.user.create({
          data: { email, name: user.name ?? null, role: Role.CUSTOMER }
        });
        (user as any).id = created.id;
        // Best-effort signup-bonus grant. Failures must not block signin.
        // Phone is unknown at Google-OAuth signup so we can't enforce the
        // phone abuse-check here; IP also isn't surfaced through next-auth's
        // signIn callback. Phone-based grants happen on first OTP verification.
        try {
          const { grantSignupBonus } = await import('./signup-bonus');
          await grantSignupBonus(created.id, { phone: null, ipAddress: null });
        } catch {}
        return true;
      }
      return true;
    },
    async jwt({ token, user }) {
      // Fresh login: `user` is only present on the first call right after
      // authorize(). Mint a new session (revoking the user's other devices) and
      // stamp its id into the token. Capture device/IP best-effort for history.
      if (user?.id) {
        token.uid = user.id;
        let userAgent: string | null = null;
        let ipAddress: string | null = null;
        try {
          const h = await headers();
          userAgent = h.get('user-agent');
          ipAddress = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || null;
        } catch {
          /* no request context — fine */
        }
        const sid = await startSession(user.id, { userAgent, ipAddress });
        if (sid) token.sid = sid;
      }
      if (token.uid) {
        // Single-active-session gate: if this token's sid is no longer the
        // user's current session (a newer login superseded it, or it was
        // terminated), invalidate the token so session() returns null below.
        const active = await isSessionActive(token.uid as string, token.sid as string | undefined);
        if (!active) {
          // Strip identity entirely so neither node guards nor edge middleware
          // see a usable role — the next request lands on /login.
          return { invalid: true } as typeof token;
        }
        const u = await prisma.user.findUnique({
          where: { id: token.uid as string },
          include: { branchMemberships: { take: 1 } }
        });
        if (u) {
          token.role = u.role;
          token.phone = u.phone;
          token.email = u.email;
          token.name = u.name;
          token.branchId = u.branchMemberships[0]?.branchId ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Token was invalidated by single-session enforcement (logged out from
      // another device, or session terminated) → no session at all.
      if ((token as any).invalid || !token.uid) {
        return null as unknown as Session;
      }
      const s = session as Session;
      s.user.id = (token.uid as string) ?? '';
      s.user.role = (token.role as Role) ?? Role.CUSTOMER;
      s.user.phone = (token.phone as string | null) ?? null;
      s.user.email = (token.email as string | null) ?? null;
      s.user.name = (token.name as string | null) ?? null;
      s.user.branchId = (token.branchId as string | null) ?? null;
      return s;
    }
  },
  events: {
    // Revoke the DB session on explicit sign-out so login history reflects it
    // and the sid can never be reused. Best-effort — never blocks logout.
    async signOut(message) {
      const sid = (message as { token?: { sid?: string } })?.token?.sid;
      if (sid) await revokeSession(sid, 'logout');
    }
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await auth();
  if (!session?.user || !roles.includes(session.user.role)) {
    throw new Response('Forbidden', { status: 403 });
  }
  return session;
}

export { sendOtp };
